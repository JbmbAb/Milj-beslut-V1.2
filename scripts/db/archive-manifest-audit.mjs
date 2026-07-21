/**
 * Manifest audit for canonical GEO_Master_Archive/Data on Drive (read-only by default).
 *
 * Phase 1 (default): inventory — no hashes, no writes
 *   node scripts/db/archive-manifest-audit.mjs
 *
 * Phase 2: propose draft manifests locally (rclone SHA-256 per dataset)
 *   node scripts/db/archive-manifest-audit.mjs --propose
 *   node scripts/db/archive-manifest-audit.mjs --propose --report=storage/manifests/manifest-audit-report.json --version=2026-06-22
 *
 * Phase 3: upload approved proposals to Drive
 *   node scripts/db/archive-manifest-audit.mjs --execute --csv=storage/manifests/manifest-audit-proposals.csv
 *
 * Outputs:
 *   storage/manifests/manifest-audit-report.json
 *   storage/manifests/manifest-audit-missing.csv
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  buildArchiveManifestV2,
  ensureArchiveManifestV2,
  validateArchiveManifestStructure,
} from '../import/types/manifestSchema.mjs';

const ROOT = process.cwd();
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const DATA_REMOTE = 'drive:GEO_Master_Archive/Data';
const REPORT_JSON = path.join(ROOT, 'storage/manifests/manifest-audit-report.json');
const MISSING_CSV = path.join(ROOT, 'storage/manifests/manifest-audit-missing.csv');
const PROPOSALS_DIR = path.join(ROOT, 'storage/manifests/manifest-proposals');
const PROPOSALS_CSV = path.join(ROOT, 'storage/manifests/manifest-audit-proposals.csv');

const PROPOSE = process.argv.includes('--propose');
const EXECUTE = process.argv.includes('--execute');
const PROPOSE_ONLY = process.argv.includes('--propose-only');
const RESUME = process.argv.includes('--resume');
const VALIDATE = process.argv.includes('--validate') || PROPOSE || EXECUTE;
const CSV_ARG = process.argv.find((a) => a.startsWith('--csv='));
const CSV_PATH = CSV_ARG ? path.resolve(CSV_ARG.slice('--csv='.length)) : PROPOSALS_CSV;
const REPORT_ARG = process.argv.find((a) => a.startsWith('--report='));
const REPORT_PATH = REPORT_ARG
  ? path.resolve(REPORT_ARG.slice('--report='.length))
  : REPORT_JSON;
const VERSION_FILTER = process.argv.find((a) => a.startsWith('--version='))?.slice('--version='.length) ?? '';
const PROVIDER_FILTER = process.argv.find((a) => a.startsWith('--provider='))?.slice('--provider='.length) ?? '';
const BATCH_SUFFIX = VERSION_FILTER ? `-${VERSION_FILTER}` : '';
const PROPOSALS_CSV_OUT = VERSION_FILTER
  ? path.join(ROOT, `storage/manifests/manifest-audit-proposals${BATCH_SUFFIX}.csv`)
  : PROPOSALS_CSV;
const PROPOSALS_DIR_OUT = VERSION_FILTER
  ? path.join(PROPOSALS_DIR, VERSION_FILTER)
  : PROPOSALS_DIR;

/** @typedef {'ok'|'missing'|'invalid_schema'|'invalid_json'|'hash_mismatch'|'empty_dataset'} ManifestStatus */

function rclone(args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
  return execFileSync(
    'docker',
    [
      'run', '--rm', '--dns', '8.8.8.8',
      '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
      'rclone/rclone',
      ...args,
      '--config', '/config/rclone/rclone.conf',
    ],
    { encoding: 'utf8', maxBuffer },
  );
}

function rcloneJson(args) {
  const out = rclone(args, { maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out || '[]');
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Expected layout: Data/<provider>/<dataset>/<version>/manifest.json
 * with raw/ sibling: .../<version>/raw/
 */
function parseDatasetKey(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const version = parts[parts.length - 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) return null;
  const dataset = parts[parts.length - 2];
  const provider = parts.slice(0, parts.length - 2).join('/');
  return { provider, dataset, version, relPath: parts.join('/') };
}

function matchesFilters(row) {
  if (VERSION_FILTER && row.version !== VERSION_FILTER) return false;
  if (PROVIDER_FILTER && !String(row.provider).startsWith(PROVIDER_FILTER)) return false;
  return true;
}

function loadReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error(`Report not found: ${REPORT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
}

function manifestIdentity(row) {
  const parts = String(row.provider).split('/');
  const provider = parts[0];
  const dataset = parts.length > 1
    ? `${parts.slice(1).join('/')}/${row.dataset}`
    : String(row.dataset);
  return { provider, dataset };
}

function librarianSchemaOk(manifest) {
  const validated = validateArchiveManifestStructure(manifest);
  return validated.ok;
}

function discoverVersionDirs() {
  /** @type {Map<string, { provider: string, dataset: string, version: string, relPath: string, hasRaw: boolean, entryCount: number }>} */
  const versions = new Map();

  const entries = rclone([
    'lsf', DATA_REMOTE,
    '-R',
    '--files-only',
  ]);

  /** @type {Set<string>} */
  const manifestParents = new Set();

  for (const line of entries.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rel = line.trim().replace(/\\/g, '/');
    if (rel.endsWith('/manifest.json') || rel === 'manifest.json') {
      const parent = rel.replace(/\/?manifest\.json$/, '');
      manifestParents.add(parent);
      continue;
    }
    if (rel.includes('/raw/')) {
      const rawIdx = rel.indexOf('/raw/');
      const versionPath = rel.slice(0, rawIdx);
      const key = versionPath;
      const parsed = parseDatasetKey(versionPath);
      if (!parsed) continue;
      const cur = versions.get(key) ?? {
        ...parsed,
        hasRaw: true,
        entryCount: 0,
      };
      cur.entryCount++;
      versions.set(key, cur);
    }
  }

  for (const parent of manifestParents) {
    if (!versions.has(parent)) {
      const parsed = parseDatasetKey(parent);
      if (parsed) {
        versions.set(parent, { ...parsed, hasRaw: false, entryCount: 0 });
      }
    }
  }

  return { versions, manifestParents };
}

function fetchManifestJson(manifestRemote) {
  try {
    const out = rclone(['cat', manifestRemote]);
    return { manifest: JSON.parse(out), error: null };
  } catch (err) {
    return { manifest: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function auditInventory() {
  console.log('Scanning Data/ on Drive (read-only)...');
  const { versions, manifestParents } = discoverVersionDirs();

  /** @type {Array<Record<string, unknown>>} */
  const rows = [];
  const summary = {
    versionDirs: versions.size,
    withManifest: 0,
    missing: 0,
    invalid: 0,
    ok: 0,
  };

  for (const [key, info] of [...versions.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const manifestRel = `${key}/manifest.json`;
    const manifestRemote = `${DATA_REMOTE}/${manifestRel}`;
    const hasManifest = manifestParents.has(key);

    /** @type {ManifestStatus} */
    let status = 'missing';
    let note = '';

    if (!hasManifest) {
      summary.missing++;
      if (info.entryCount === 0 && !info.hasRaw) note = 'version folder without raw/ files detected';
    } else {
      summary.withManifest++;
      if (VALIDATE) {
        const { manifest, error } = fetchManifestJson(manifestRemote);
        if (error) {
          status = 'invalid_json';
          note = error.slice(0, 200);
          summary.invalid++;
        } else if (!librarianSchemaOk(manifest)) {
          status = 'invalid_schema';
          note = 'missing provider/dataset/content_bundle_sha256/files[]';
          summary.invalid++;
        } else if (
          manifest.provider !== info.provider.split('/').pop()
          && manifest.provider !== info.provider
        ) {
          status = 'invalid_schema';
          note = `provider mismatch manifest=${manifest.provider} path=${info.provider}`;
          summary.invalid++;
        } else {
          status = 'ok';
          summary.ok++;
        }
      } else {
        status = 'ok';
        summary.ok++;
      }
    }

    rows.push({
      provider: info.provider,
      dataset: info.dataset,
      version: info.version,
      rel_path: info.relPath,
      manifest_rel: manifestRel,
      manifest_remote: manifestRemote,
      status,
      has_raw: info.hasRaw,
      file_entries_under_raw: info.entryCount,
      note,
      proposed_action: status === 'missing' ? 'propose_manifest' : status === 'ok' ? 'none' : 'manual_review',
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_inventory',
    dataRoot: DATA_REMOTE,
    summary,
    rows,
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const missing = rows.filter((r) => r.status === 'missing' || r.status === 'invalid_schema' || r.status === 'invalid_json');
  const csvHeader = [
    'provider', 'dataset', 'version', 'rel_path', 'status', 'manifest_rel', 'note', 'proposed_action', 'approved',
  ];
  const csvLines = [
    csvHeader.join(','),
    ...missing.map((r) => csvHeader.map((h) => csvEscape(r[h] ?? '')).join(',')),
    ...rows.filter((r) => r.status === 'ok').slice(0, 0).map(() => ''),
  ].filter(Boolean);
  fs.writeFileSync(MISSING_CSV, `${csvLines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${REPORT_JSON}`);
  console.log(`Missing/invalid CSV: ${MISSING_CSV}`);
  return report;
}

function bundleHashFromRcloneHashes(rows) {
  const parts = rows
    .map((r) => `${r.relPath}:${r.hash}`)
    .sort();
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function rcloneHashsum(remotePath) {
  try {
    const out = rclone([
      'hashsum', 'SHA256', remotePath,
      '--fast-list',
      '--download',
    ], { maxBuffer: 512 * 1024 * 1024 });
    /** @type {{ hash: string, size: number, relPath: string }[]} */
    const rows = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const hash = parts[0].toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      let size = 0;
      let relPath;
      if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
        size = Number(parts[1]);
        relPath = parts.slice(2).join(' ');
      } else {
        relPath = parts.slice(1).join(' ');
      }
      rows.push({ hash, size, relPath: relPath.replace(/\\/g, '/') });
    }
    return { rows, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rows: [], error: msg };
  }
}

function proposeManifests(report) {
  fs.mkdirSync(PROPOSALS_DIR_OUT, { recursive: true });
  let targets = report.rows.filter((r) => r.status === 'missing');
  targets = targets.filter(matchesFilters);
  const filterDesc = [
    VERSION_FILTER ? `version=${VERSION_FILTER}` : null,
    PROVIDER_FILTER ? `provider=${PROVIDER_FILTER}*` : null,
  ].filter(Boolean).join(', ');
  console.log(
    `Proposing manifests for ${targets.length} datasets (SHA-256 via rclone)${filterDesc ? ` [${filterDesc}]` : ''}...`,
  );

  /** @type {Array<Record<string, unknown>>} */
  const proposals = [];

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const safeName = `${row.provider}__${row.dataset}__${row.version}`.replace(/[^\w.-]+/g, '_');
    const localPath = path.join(PROPOSALS_DIR_OUT, `${safeName}.json`);

    if (RESUME && fs.existsSync(localPath)) {
      proposals.push({
        ...row,
        proposal_status: 'ready',
        proposal_local: localPath,
        note: 'resumed_existing',
        approved: 'false',
      });
      continue;
    }

    const rawRemote = row.has_raw
      ? `${DATA_REMOTE}/${row.rel_path}/raw`
      : `${DATA_REMOTE}/${row.rel_path}`;
    console.log(`[${i + 1}/${targets.length}] ${row.rel_path}`);
    const { rows: hashes, error: hashError } = rcloneHashsum(rawRemote);
    if (hashError) {
      console.warn(`  SKIP hash failed: ${hashError.slice(0, 120)}`);
      proposals.push({
        ...row,
        proposal_status: 'hash_failed',
        note: hashError.slice(0, 200),
        approved: 'false',
      });
      continue;
    }
    if (hashes.length === 0) {
      proposals.push({ ...row, proposal_status: 'empty_dataset', approved: 'false' });
      continue;
    }
    const totalBytes = hashes.reduce((s, h) => s + h.size, 0);
    const files = [...new Set(hashes.map((h) => h.relPath.split('/')[0]))];
    const content_bundle_sha256 = bundleHashFromRcloneHashes(
      hashes.map((h) => ({ relPath: path.basename(h.relPath) || h.relPath, hash: h.hash })),
    );
    const { provider, dataset } = manifestIdentity(row);
    const manifest = buildArchiveManifestV2({
      provider,
      dataset,
      version: row.version,
      provenance: 'archive_manifest_audit_proposal',
      content_bundle_sha256,
      files: files.length > 0 ? files : hashes.map((h) => path.basename(h.relPath)),
      total_bytes: totalBytes,
      files_detail: hashes.map((h) => ({
        name: path.basename(h.relPath) || h.relPath,
        sha256: h.hash,
        size_bytes: h.size,
        rel_path: h.relPath,
      })),
    });
    fs.writeFileSync(localPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    proposals.push({
      ...row,
      proposal_status: 'ready',
      proposal_local: localPath,
      content_bundle_sha256,
      total_bytes: totalBytes,
      file_count: hashes.length,
      approved: 'false',
    });
  }

  const header = [
    'provider', 'dataset', 'version', 'rel_path', 'status', 'manifest_rel', 'proposal_local',
    'content_bundle_sha256', 'file_count', 'total_bytes', 'approved',
  ];
  fs.writeFileSync(
    PROPOSALS_CSV_OUT,
    `${[header.join(','), ...proposals.map((p) => header.map((h) => csvEscape(p[h] ?? '')).join(','))].join('\n')}\n`,
    'utf8',
  );
  console.log(`Proposals: ${PROPOSALS_DIR_OUT}`);
  console.log(`Review CSV: ${PROPOSALS_CSV_OUT}`);
}

function executeApproved() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = parseCsvRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  let uploaded = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    if (String(vals[idx.approved]).toLowerCase() !== 'true') {
      skipped++;
      continue;
    }
    const localPath = vals[idx.proposal_local];
    const manifestRel = vals[idx.manifest_rel];
    if (!localPath || !manifestRel || !fs.existsSync(localPath)) {
      console.warn(`Skip row ${i}: missing proposal file`);
      skipped++;
      continue;
    }

    const rawProposal = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const manifestV2 = ensureArchiveManifestV2(rawProposal);
    const validated = validateArchiveManifestStructure(manifestV2);
    if (!validated.ok) {
      console.warn(`Skip row ${i}: invalid manifest — ${validated.errors.join('; ')}`);
      skipped++;
      continue;
    }

    const uploadPath = path.join(ROOT, 'storage/manifests/_tmp_execute_manifest.json');
    fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
    fs.writeFileSync(uploadPath, `${JSON.stringify(validated.manifest, null, 2)}\n`, 'utf8');

    const remote = `${DATA_REMOTE}/${manifestRel}`;
    console.log(`Upload ${manifestRel} (schema_version=2.0, qa_status=${validated.manifest.qa_status})`);
    execFileSync('docker', [
      'run', '--rm', '--dns', '8.8.8.8',
      '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
      '-v', `${path.resolve(uploadPath)}:/tmp/manifest.json:ro`,
      'rclone/rclone',
      'copyto', '/tmp/manifest.json', remote,
      '--config', '/config/rclone/rclone.conf',
    ], { stdio: 'inherit' });
    uploaded++;
  }
  console.log(JSON.stringify({ uploaded, skipped }, null, 2));
}

function main() {
  if (EXECUTE) {
    executeApproved();
    return;
  }
  const report = PROPOSE_ONLY || (PROPOSE && fs.existsSync(REPORT_PATH))
    ? loadReport()
    : auditInventory();
  if (PROPOSE) proposeManifests(report);
}

main();
