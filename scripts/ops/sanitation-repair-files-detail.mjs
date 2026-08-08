/**
 * SAN-2026-010 — Repair missing files_detail on Master Archive manifests.
 *
 * Rebuilds files_detail from:
 *   1) rclone hashsum SHA-256 index (preferred, no rehash of TB-scale payloads)
 *   2) optional local Get-FileHash fallback for small gaps
 *
 * Does NOT reharvest. Preserves existing content_bundle_sha256 when present.
 * Writes .pre-repair.bak beside each mutated manifest.
 *
 *   node scripts/ops/sanitation-repair-files-detail.mjs
 *   node scripts/ops/sanitation-repair-files-detail.mjs --execute
 *   node scripts/ops/sanitation-repair-files-detail.mjs --execute --providers=VISS,MCF,LST
 *   node scripts/ops/sanitation-repair-files-detail.mjs --execute --providers=VISS,MCF,LST,SMHI,MSB,SGU
 *   node scripts/ops/sanitation-repair-files-detail.mjs --execute --allow-local-hash
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  ensureArchiveManifestV2,
  validateArchiveManifestStructure,
} from '../import/types/manifestSchema.mjs';

const DRY = !process.argv.includes('--execute');
const ALLOW_LOCAL = process.argv.includes('--allow-local-hash');
const MASTER =
  process.env.GEO_MASTER_ARCHIVE ??
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');
const HASH_DIR = path.join(process.cwd(), 'storage', 'manifests');

const DEFAULT_PROVIDERS = ['VISS', 'MCF', 'LST'];
const providersArg = process.argv.find((a) => a.startsWith('--providers='));
const PROVIDERS = providersArg
  ? providersArg
      .slice('--providers='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_PROVIDERS;

const OP_BATCH = 'SAN-2026-010';

function walkManifests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walkManifests(fp, out);
    else if (e.name === 'manifest.json') out.push(fp);
  }
  return out;
}

/** @returns {Map<string, string>} lowercased rel path -> sha256 */
function loadHashsum(provider) {
  const file = path.join(HASH_DIR, `rclone-hashsum-${provider}.txt`);
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^([0-9a-f]{64})\s+(.*)$/i);
    if (!m) continue;
    map.set(m[2].replace(/\\/g, '/').toLowerCase(), m[1].toLowerCase());
  }
  return map;
}

function sha256Local(filePath) {
  const psPath = filePath.replace(/'/g, "''");
  try {
    const out = execFileSync(
      'pwsh',
      ['-NoProfile', '-Command', `(Get-FileHash -Algorithm SHA256 -LiteralPath '${psPath}').Hash`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    return out.trim().toLowerCase();
  } catch {
    const out = execFileSync('certutil', ['-hashfile', filePath, 'SHA256'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const line = out.split(/\r?\n/).find((l) => /^[0-9a-f]{64}$/i.test(l.trim()));
    if (!line) throw new Error(`certutil parse failed for ${filePath}`);
    return line.trim().toLowerCase();
  }
}

function resolveOnDisk(manifestDir, relEntry) {
  const candidates = [
    path.join(manifestDir, relEntry),
    path.join(manifestDir, 'raw', relEntry),
    path.join(manifestDir, path.basename(relEntry)),
    path.join(manifestDir, 'raw', path.basename(relEntry)),
    path.join(manifestDir, 'extracted', path.basename(relEntry)),
    path.join(manifestDir, 'raw', 'extracted', path.basename(relEntry)),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * @param {Map<string, string>} hashMap
 * @param {string} versionBase dataset/version relative to provider root
 * @param {string} manRelDir manifest dir relative to provider root
 * @param {string} rel files[] entry
 */
function lookupHash(hashMap, versionBase, manRelDir, rel) {
  const norm = rel.replace(/\\/g, '/');
  const base = path.posix.basename(norm);
  const candidates = [
    `${versionBase}/${norm}`,
    `${versionBase}/raw/${norm}`,
    `${manRelDir}/${norm}`,
    `${versionBase}/${base}`,
    `${versionBase}/raw/${base}`,
    `${manRelDir}/raw/${base}`,
    norm,
  ].map((c) => c.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase());

  for (const c of candidates) {
    if (hashMap.has(c)) return { sha: hashMap.get(c), via: c };
  }

  const dataset = (versionBase.split('/')[0] ?? '').toLowerCase();
  const needle = `/${base.toLowerCase()}`;
  for (const [k, v] of hashMap) {
    if (k.endsWith(needle) || k === base.toLowerCase()) {
      if (!dataset || k.includes(dataset)) return { sha: v, via: k };
    }
  }
  return null;
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeDual(name, obj) {
  writeJson(path.join(OPS_DIR, name), obj);
  writeJson(path.join(REPO_OPS, name), obj);
}

/**
 * @param {string} provider
 * @param {Map<string, string>} hashMap
 */
function repairProvider(provider, hashMap) {
  const providerRoot = path.join(DATA, provider);
  const manifests = walkManifests(providerRoot);
  /** @type {object[]} */
  const results = [];
  let opSeq = 0;

  for (const manifestPath of manifests) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      results.push({
        status: 'error',
        manifest: path.relative(providerRoot, manifestPath),
        note: `parse failed: ${err.message}`,
      });
      continue;
    }

    const existingDetail = Array.isArray(raw.files_detail) ? raw.files_detail : [];
    if (existingDetail.length > 0) {
      results.push({
        status: 'skip_has_detail',
        manifest: path.relative(providerRoot, manifestPath),
        files_detail: existingDetail.length,
      });
      continue;
    }

    const rawFiles = Array.isArray(raw.files) ? raw.files : [];
    /** @type {string[]} */
    const files = [];
    /** @type {Array<{ name: string, sha256: string, size_bytes: number, rel_path: string }>} */
    const embeddedDetail = [];

    for (const entry of rawFiles) {
      if (typeof entry === 'string') {
        files.push(entry.replace(/\\/g, '/'));
        continue;
      }
      if (entry && typeof entry === 'object') {
        const o = /** @type {Record<string, unknown>} */ (entry);
        const rel =
          typeof o.rel_path === 'string'
            ? o.rel_path
            : typeof o.path === 'string'
              ? o.path
              : typeof o.name === 'string'
                ? o.name
                : typeof o.filename === 'string'
                  ? o.filename
                  : typeof o.source_rel === 'string'
                    ? path.posix.basename(o.source_rel.replace(/\\/g, '/'))
                    : null;
        if (!rel) continue;
        const norm = rel.replace(/\\/g, '/');
        files.push(norm);
        const sha = typeof o.sha256 === 'string' ? o.sha256.toLowerCase() : '';
        if (/^[0-9a-f]{64}$/.test(sha)) {
          embeddedDetail.push({
            name: path.posix.basename(norm),
            sha256: sha,
            size_bytes: typeof o.size_bytes === 'number' ? o.size_bytes : 0,
            rel_path: norm,
          });
        }
      }
    }

    if (!files.length) {
      results.push({
        status: 'skip_empty_files',
        manifest: path.relative(providerRoot, manifestPath),
        note: 'manifest.files empty or unparseable object entries',
      });
      continue;
    }

    // Legacy shape: hashes already live inside files[] objects — promote to files_detail.
    if (embeddedDetail.length === files.length) {
      const manRelDir = path.relative(providerRoot, path.dirname(manifestPath)).replace(/\\/g, '/');
      const manifestDir = path.dirname(manifestPath);
      const totalBytes = embeddedDetail.reduce((a, d) => a + (d.size_bytes || 0), 0);
      const bundleFallback = crypto
        .createHash('sha256')
        .update(
          embeddedDetail
            .map((d) => `${d.name}:${d.sha256}`)
            .sort()
            .join('|'),
        )
        .digest('hex');

      /** @type {Record<string, unknown>} */
      const toWrite = {
        ...raw,
        files: files,
        files_detail: embeddedDetail,
        total_bytes:
          typeof raw.total_bytes === 'number' && raw.total_bytes > 0 ? raw.total_bytes : totalBytes,
        content_bundle_sha256:
          typeof raw.content_bundle_sha256 === 'string' && raw.content_bundle_sha256.length > 0
            ? raw.content_bundle_sha256
            : bundleFallback,
        schema_version: raw.schema_version === '2.0' ? '2.0' : '2.0',
        provenance: typeof raw.provenance === 'string' ? raw.provenance : 'legacy_promotion',
        qa_status: typeof raw.qa_status === 'string' ? raw.qa_status : 'pending',
        qa_at: new Date().toISOString(),
      };

      const validated = validateArchiveManifestStructure(toWrite);
      if (!validated.ok) {
        results.push({
          status: 'error',
          manifest: path.relative(providerRoot, manifestPath),
          note: validated.errors.join('; '),
        });
        continue;
      }

      opSeq += 1;
      const opId = `${OP_BATCH}-${provider}-${String(opSeq).padStart(3, '0')}`;
      const artifact = {
        schema_version: '1.0',
        operation_id: opId,
        action: 'REPAIR_MANIFEST',
        reason: 'incomplete_harvest',
        source: path.relative(MASTER, manifestPath).replace(/\\/g, '/'),
        target: path.relative(MASTER, manifestPath).replace(/\\/g, '/'),
        provider,
        dataset: String(toWrite.dataset ?? ''),
        files: embeddedDetail.length,
        old_hashes: [],
        new_hashes: embeddedDetail.map((d) => d.sha256),
        approved_by: 'JbmbAb',
        created_at: new Date().toISOString(),
        closed_at: DRY ? undefined : new Date().toISOString(),
        status: DRY ? 'planned' : 'completed',
        notes:
          'Promoted embedded sha256 from legacy files[] objects into files_detail; normalized files[] to paths.',
        evidence: { hash_sources: { embedded: embeddedDetail.length, rclone: 0, local: 0 } },
      };

      if (!DRY) {
        fs.copyFileSync(manifestPath, `${manifestPath}.pre-repair.bak`);
        fs.writeFileSync(manifestPath, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
        writeDual(`${opId}.json`, artifact);
        const checksumsPath = path.join(manifestDir, 'checksums.txt');
        if (!fs.existsSync(checksumsPath)) {
          fs.writeFileSync(
            checksumsPath,
            `${embeddedDetail.map((d) => `${d.sha256}  ${d.rel_path}`).join('\n')}\n`,
            'utf8',
          );
        }
      } else {
        writeDual(`${opId}.json`, artifact);
      }

      results.push({
        status: DRY ? 'planned' : 'repaired',
        operation_id: opId,
        manifest: path.relative(providerRoot, manifestPath),
        files: embeddedDetail.length,
        rclone_hashes: 0,
        local_hashes: 0,
        embedded_hashes: embeddedDetail.length,
        size_bytes_zero: embeddedDetail.filter((d) => d.size_bytes === 0).length,
        via: 'embedded_files_objects',
      });
      continue;
    }

    const manRelDir = path.relative(providerRoot, path.dirname(manifestPath)).replace(/\\/g, '/');
    const versionBase = manRelDir.replace(/\/raw$/i, '');
    const manifestDir = path.dirname(manifestPath);

    /** @type {Array<{ name: string, sha256: string, size_bytes: number, rel_path: string }>} */
    const detail = [];
    /** @type {string[]} */
    const missing = [];
    let totalBytes = 0;
    let usedLocal = 0;
    let usedRclone = 0;

    for (const rel of files) {
      const hit = lookupHash(hashMap, versionBase, manRelDir, rel);
      const onDisk = resolveOnDisk(manifestDir, rel);
      let sha = hit?.sha ?? null;
      let size = 0;

      if (onDisk) {
        try {
          size = fs.statSync(onDisk).size;
        } catch {
          size = 0;
        }
      }

      if (!sha && ALLOW_LOCAL && onDisk) {
        try {
          sha = sha256Local(onDisk);
          usedLocal += 1;
        } catch (err) {
          missing.push(`${rel} (local hash failed: ${err.message})`);
          continue;
        }
      } else if (sha) {
        usedRclone += 1;
      }

      if (!sha) {
        missing.push(rel);
        continue;
      }

      totalBytes += size;
      detail.push({
        name: path.posix.basename(rel.replace(/\\/g, '/')),
        sha256: sha,
        size_bytes: size,
        rel_path: rel.replace(/\\/g, '/'),
      });
    }

    if (missing.length) {
      results.push({
        status: 'incomplete',
        manifest: path.relative(providerRoot, manifestPath),
        found: detail.length,
        missing: missing.slice(0, 20),
        missing_count: missing.length,
      });
      continue;
    }

    const bundleFallback = crypto
      .createHash('sha256')
      .update(
        detail
          .map((d) => `${d.name}:${d.sha256}`)
          .sort()
          .join('|'),
      )
      .digest('hex');

    // Preserve all legacy extras (counts, note, downloaded_at, …); only add receipts.
    /** @type {Record<string, unknown>} */
    const merged = {
      ...raw,
      files_detail: detail,
      total_bytes:
        typeof raw.total_bytes === 'number' && raw.total_bytes > 0 ? raw.total_bytes : totalBytes,
      content_bundle_sha256:
        typeof raw.content_bundle_sha256 === 'string' && raw.content_bundle_sha256.length > 0
          ? raw.content_bundle_sha256
          : bundleFallback,
      qa_at: new Date().toISOString(),
    };

    // Upgrade to v2 shape when missing schema/qa, without dropping extras.
    if (merged.schema_version !== '2.0') {
      const v2 = ensureArchiveManifestV2(merged);
      Object.assign(merged, v2, {
        files_detail: detail,
        content_bundle_sha256: merged.content_bundle_sha256,
        total_bytes: merged.total_bytes,
      });
      // re-apply extras that ensureArchiveManifestV2 strips
      for (const [k, v] of Object.entries(raw)) {
        if (!(k in merged)) merged[k] = v;
      }
    }

    const validated = validateArchiveManifestStructure(merged);
    if (!validated.ok) {
      results.push({
        status: 'error',
        manifest: path.relative(providerRoot, manifestPath),
        note: validated.errors.join('; '),
      });
      continue;
    }

    // Write merged (with extras), not the stripped v2-only object.
    const toWrite = { ...merged, ...validated.manifest, files_detail: detail };
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in toWrite) || k === 'counts' || k === 'note' || k === 'downloaded_at') {
        if (raw[k] !== undefined) toWrite[k] = raw[k];
      }
    }
    toWrite.files_detail = detail;
    if (raw.content_bundle_sha256) toWrite.content_bundle_sha256 = raw.content_bundle_sha256;

    opSeq += 1;
    const opId = `${OP_BATCH}-${provider}-${String(opSeq).padStart(3, '0')}`;
    const artifact = {
      schema_version: '1.0',
      operation_id: opId,
      action: 'REPAIR_MANIFEST',
      reason: 'incomplete_harvest',
      source: path.relative(MASTER, manifestPath).replace(/\\/g, '/'),
      target: path.relative(MASTER, manifestPath).replace(/\\/g, '/'),
      provider,
      dataset: String(toWrite.dataset ?? ''),
      files: detail.length,
      old_hashes: raw.content_bundle_sha256 ? [String(raw.content_bundle_sha256)] : [],
      new_hashes: detail.map((d) => d.sha256),
      approved_by: 'JbmbAb',
      created_at: new Date().toISOString(),
      closed_at: DRY ? undefined : new Date().toISOString(),
      status: DRY ? 'planned' : 'completed',
      notes:
        'Added files_detail from rclone SHA-256 hashsum index; preserved content_bundle_sha256; no reharvest.',
      evidence: {
        hash_sources: { rclone: usedRclone, local: usedLocal },
        total_bytes_observed: totalBytes,
        size_bytes_zero: detail.filter((d) => d.size_bytes === 0).length,
      },
    };

    if (!DRY) {
      fs.copyFileSync(manifestPath, `${manifestPath}.pre-repair.bak`);
      fs.writeFileSync(manifestPath, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');

      // Keep sibling copy in sync only if it previously lacked files_detail.
      const siblings = [
        path.join(manifestDir, 'raw', 'manifest.json'),
        path.join(path.dirname(manifestDir), 'manifest.json'),
      ];
      for (const sib of siblings) {
        if (sib === manifestPath || !fs.existsSync(sib)) continue;
        try {
          const sibMan = JSON.parse(fs.readFileSync(sib, 'utf8'));
          const sibFd = Array.isArray(sibMan.files_detail) ? sibMan.files_detail : [];
          if (sibFd.length === 0) {
            const sibMerged = { ...sibMan, files_detail: detail, qa_at: toWrite.qa_at };
            if (!sibMan.content_bundle_sha256 && toWrite.content_bundle_sha256) {
              sibMerged.content_bundle_sha256 = toWrite.content_bundle_sha256;
            }
            fs.copyFileSync(sib, `${sib}.pre-repair.bak`);
            fs.writeFileSync(sib, `${JSON.stringify(sibMerged, null, 2)}\n`, 'utf8');
          }
        } catch {
          // leave sibling alone
        }
      }

      writeDual(`${opId}.json`, artifact);

      const checksumsPath = path.join(manifestDir, 'checksums.txt');
      if (!fs.existsSync(checksumsPath)) {
        fs.writeFileSync(
          checksumsPath,
          `${detail.map((d) => `${d.sha256}  ${d.rel_path}`).join('\n')}\n`,
          'utf8',
        );
      }
    } else {
      writeDual(`${opId}.json`, artifact);
    }

    results.push({
      status: DRY ? 'planned' : 'repaired',
      operation_id: opId,
      manifest: path.relative(providerRoot, manifestPath),
      files: detail.length,
      rclone_hashes: usedRclone,
      local_hashes: usedLocal,
      size_bytes_zero: detail.filter((d) => d.size_bytes === 0).length,
    });
  }

  return results;
}

function main() {
  console.log(
    `${DRY ? 'DRY-RUN' : 'EXECUTE'} ${OP_BATCH} providers=${PROVIDERS.join(',')} allow_local_hash=${ALLOW_LOCAL}`,
  );

  /** @type {Record<string, object>} */
  const byProvider = {};
  let repaired = 0;
  let incomplete = 0;
  let skipped = 0;
  let errors = 0;

  for (const provider of PROVIDERS) {
    const hashMap = loadHashsum(provider);
    if (hashMap.size === 0) {
      console.warn(`WARN: no hashsum index for ${provider} at storage/manifests/rclone-hashsum-${provider}.txt`);
    }
    const results = repairProvider(provider, hashMap);
    byProvider[provider] = {
      hashsum_entries: hashMap.size,
      results,
      repaired: results.filter((r) => r.status === 'repaired' || r.status === 'planned').length,
      incomplete: results.filter((r) => r.status === 'incomplete').length,
      skipped: results.filter((r) => String(r.status).startsWith('skip_')).length,
      errors: results.filter((r) => r.status === 'error').length,
    };
    repaired += byProvider[provider].repaired;
    incomplete += byProvider[provider].incomplete;
    skipped += byProvider[provider].skipped;
    errors += byProvider[provider].errors;
  }

  const batch = {
    schema_version: '1.0',
    operation_id: OP_BATCH,
    action: 'REPAIR_MANIFEST',
    reason: 'incomplete_harvest',
    source: 'Data/{VISS,MCF,LST}/**/manifest.json (missing files_detail)',
    provider: PROVIDERS.join(','),
    approved_by: 'JbmbAb',
    created_at: new Date().toISOString(),
    closed_at: DRY ? undefined : new Date().toISOString(),
    status: DRY ? 'planned' : incomplete || errors ? 'in_progress' : 'completed',
    notes:
      'P3 metadata repair: populate files_detail from rclone hashsum. No payload rewrite. No reharvest.',
    evidence: {
      dry_run: DRY,
      allow_local_hash: ALLOW_LOCAL,
      providers: PROVIDERS,
      totals: { repaired, incomplete, skipped, errors },
      by_provider: Object.fromEntries(
        Object.entries(byProvider).map(([k, v]) => [
          k,
          {
            hashsum_entries: v.hashsum_entries,
            repaired: v.repaired,
            incomplete: v.incomplete,
            skipped: v.skipped,
            errors: v.errors,
          },
        ]),
      ),
    },
  };
  writeDual(`${OP_BATCH}.json`, batch);

  const summaryPath = path.join(REPO_OPS, `${OP_BATCH}-summary.json`);
  writeJson(summaryPath, { batch, byProvider });

  console.log(
    JSON.stringify(
      {
        dry_run: DRY,
        repaired,
        incomplete,
        skipped,
        errors,
        by_provider: batch.evidence.by_provider,
        summary: summaryPath,
      },
      null,
      2,
    ),
  );

  if (errors > 0) process.exit(1);
}

main();
