/**
 * Full GEO_Master_Archive inventory + optional SHA-256 verify against manifests.
 *
 *   node scripts/db/archive-full-inventory-verify.mjs
 *   node scripts/db/archive-full-inventory-verify.mjs --hash
 *   node scripts/db/archive-full-inventory-verify.mjs --hash --max-hash-files=200
 *   node scripts/db/archive-full-inventory-verify.mjs --provider=SGU
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const OUT_JSON = path.join(ROOT, 'storage/manifests/archive-full-inventory.json');
const OUT_CSV = path.join(ROOT, 'storage/manifests/archive-full-inventory.csv');

const DO_HASH = process.argv.includes('--hash');
const PROVIDER_FILTER = process.argv.find((a) => a.startsWith('--provider='))?.slice('--provider='.length) ?? '';
const MAX_HASH = Number(process.argv.find((a) => a.startsWith('--max-hash-files='))?.split('=')[1] ?? '500');

/** @typedef {'ok'|'checksum_missing'|'checksum_mismatch'|'file_missing'|'invalid_manifest'|'unreadable_manifest'|'no_manifest_legacy'} RowStatus */

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function walkManifests(dir, depth = 0, maxDepth = 10, out = []) {
  if (depth > maxDepth) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'manifest.json') {
      out.push(fp);
    } else if (e.isDirectory() && !e.name.startsWith('.')) {
      walkManifests(fp, depth + 1, maxDepth, out);
    }
  }
  return out;
}

function sha256File(filePath) {
  const psPath = filePath.replace(/'/g, "''");
  try {
    const out = execFileSync(
      'pwsh',
      ['-NoProfile', '-Command', `(Get-FileHash -Algorithm SHA256 -LiteralPath '${psPath}').Hash`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const hash = out.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hash)) return hash;
  } catch {
    // fall through
  }
  const out = execFileSync('certutil', ['-hashfile', filePath, 'SHA256'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const line = out.split(/\r?\n/).find((l) => /^[0-9a-f]{64}$/i.test(l.trim()));
  if (!line) throw new Error(`hash failed: ${filePath}`);
  return line.trim().toLowerCase();
}

function resolveFile(manifestDir, fd) {
  const rel = fd.rel_path ?? fd.name;
  const name = fd.name ?? path.basename(String(rel));
  const candidates = [
    path.join(manifestDir, rel),
    path.join(manifestDir, 'raw', rel),
    path.join(manifestDir, name),
    path.join(manifestDir, 'raw', name),
    path.join(path.dirname(manifestDir), rel),
    path.join(path.dirname(manifestDir), 'raw', rel),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // continue
    }
  }
  return null;
}

function providerFromPath(manifestPath) {
  const rel = path.relative(DATA, manifestPath);
  const parts = rel.split(path.sep);
  return parts[0] || 'unknown';
}

function datasetFromPath(manifestPath) {
  const rel = path.relative(DATA, manifestPath);
  const parts = rel.split(path.sep);
  // Provider / Dataset / version / [raw]/manifest.json
  if (parts.length >= 3) return parts.slice(1, -1).filter((p) => !/^\d{4}-\d{2}-\d{2}/.test(p) && p !== 'raw').join('/');
  return parts.slice(1).join('/');
}

function inspectManifest(manifestPath) {
  const provider = providerFromPath(manifestPath);
  const dataset = datasetFromPath(manifestPath);
  const manifestDir = path.dirname(manifestPath);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      provider,
      dataset,
      status: /** @type {RowStatus} */ ('unreadable_manifest'),
      manifest_path: manifestPath,
      version: null,
      file_entries: 0,
      hashed_ok: 0,
      note: err instanceof Error ? err.message : String(err),
      total_bytes: 0,
      schema_version: null,
      content_bundle_sha256: null,
    };
  }

  if (!manifest || typeof manifest !== 'object') {
    return {
      provider,
      dataset,
      status: 'invalid_manifest',
      manifest_path: manifestPath,
      version: null,
      file_entries: 0,
      hashed_ok: 0,
      note: 'manifest is not an object',
      total_bytes: 0,
      schema_version: null,
      content_bundle_sha256: null,
    };
  }

  const version = typeof manifest.version === 'string' ? manifest.version : path.basename(path.dirname(manifestDir === path.join(path.dirname(manifestPath), 'raw') ? path.dirname(manifestPath) : manifestDir));
  const details = Array.isArray(manifest.files_detail) ? manifest.files_detail : [];
  const hasBundle = typeof manifest.content_bundle_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(manifest.content_bundle_sha256);
  const totalBytes = Number(manifest.total_bytes ?? 0) || 0;

  if (!details.length && !hasBundle) {
    return {
      provider,
      dataset,
      status: 'checksum_missing',
      manifest_path: manifestPath,
      version: typeof manifest.version === 'string' ? manifest.version : version,
      file_entries: Array.isArray(manifest.files) ? manifest.files.length : 0,
      hashed_ok: 0,
      note: 'no files_detail and no content_bundle_sha256',
      total_bytes: totalBytes,
      schema_version: manifest.schema_version ?? null,
      content_bundle_sha256: null,
    };
  }

  if (!details.length && hasBundle) {
    return {
      provider,
      dataset,
      status: 'checksum_missing',
      manifest_path: manifestPath,
      version: typeof manifest.version === 'string' ? manifest.version : version,
      file_entries: Array.isArray(manifest.files) ? manifest.files.length : 0,
      hashed_ok: 0,
      note: 'bundle hash present but files_detail absent (cannot verify file-level)',
      total_bytes: totalBytes,
      schema_version: manifest.schema_version ?? null,
      content_bundle_sha256: manifest.content_bundle_sha256,
    };
  }

  if (!DO_HASH) {
    const missingSha = details.filter((d) => !d?.sha256 || !/^[0-9a-f]{64}$/i.test(String(d.sha256))).length;
    return {
      provider,
      dataset,
      status: missingSha ? 'checksum_missing' : 'ok',
      manifest_path: manifestPath,
      version: typeof manifest.version === 'string' ? manifest.version : version,
      file_entries: details.length,
      hashed_ok: 0,
      note: missingSha
        ? `${missingSha}/${details.length} files_detail without sha256`
        : 'manifest checksums present (run --hash to verify)',
      total_bytes: totalBytes,
      schema_version: manifest.schema_version ?? null,
      content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
    };
  }

  let hashedOk = 0;
  let checked = 0;
  for (const fd of details) {
    if (checked >= MAX_HASH) {
      return {
        provider,
        dataset,
        status: 'ok',
        manifest_path: manifestPath,
        version: typeof manifest.version === 'string' ? manifest.version : version,
        file_entries: details.length,
        hashed_ok: hashedOk,
        note: `hash capped at ${MAX_HASH} files (${hashedOk} ok); remaining unchecked`,
        total_bytes: totalBytes,
        schema_version: manifest.schema_version ?? null,
        content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
      };
    }
    if (!fd?.sha256 || !/^[0-9a-f]{64}$/i.test(String(fd.sha256))) {
      return {
        provider,
        dataset,
        status: 'checksum_missing',
        manifest_path: manifestPath,
        version: typeof manifest.version === 'string' ? manifest.version : version,
        file_entries: details.length,
        hashed_ok: hashedOk,
        note: `files_detail entry missing sha256: ${fd?.name ?? fd?.rel_path ?? '?'}`,
        total_bytes: totalBytes,
        schema_version: manifest.schema_version ?? null,
        content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
      };
    }
    const filePath = resolveFile(manifestDir, fd);
    if (!filePath) {
      return {
        provider,
        dataset,
        status: 'file_missing',
        manifest_path: manifestPath,
        version: typeof manifest.version === 'string' ? manifest.version : version,
        file_entries: details.length,
        hashed_ok: hashedOk,
        note: `missing on disk: ${fd.name ?? fd.rel_path}`,
        total_bytes: totalBytes,
        schema_version: manifest.schema_version ?? null,
        content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
      };
    }
    checked += 1;
    let actual;
    try {
      actual = sha256File(filePath);
    } catch (err) {
      return {
        provider,
        dataset,
        status: 'file_missing',
        manifest_path: manifestPath,
        version: typeof manifest.version === 'string' ? manifest.version : version,
        file_entries: details.length,
        hashed_ok: hashedOk,
        note: `unreadable for hash: ${filePath} (${err instanceof Error ? err.message : String(err)})`,
        total_bytes: totalBytes,
        schema_version: manifest.schema_version ?? null,
        content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
      };
    }
    if (actual !== String(fd.sha256).toLowerCase()) {
      return {
        provider,
        dataset,
        status: 'checksum_mismatch',
        manifest_path: manifestPath,
        version: typeof manifest.version === 'string' ? manifest.version : version,
        file_entries: details.length,
        hashed_ok: hashedOk,
        note: `mismatch: ${fd.name ?? fd.rel_path} expected=${String(fd.sha256).slice(0, 12)}… actual=${actual.slice(0, 12)}…`,
        total_bytes: totalBytes,
        schema_version: manifest.schema_version ?? null,
        content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
      };
    }
    hashedOk += 1;
  }

  return {
    provider,
    dataset,
    status: 'ok',
    manifest_path: manifestPath,
    version: typeof manifest.version === 'string' ? manifest.version : version,
    file_entries: details.length,
    hashed_ok: hashedOk,
    note: `verified ${hashedOk} file hash(es)`,
    total_bytes: totalBytes,
    schema_version: manifest.schema_version ?? null,
    content_bundle_sha256: hasBundle ? manifest.content_bundle_sha256 : null,
  };
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function inventoryProviders() {
  /** @type {Array<{ provider: string, dataset_dirs: number, sample_datasets: string[] }>} */
  const rows = [];
  for (const provider of listDirs(DATA)) {
    if (PROVIDER_FILTER && provider !== PROVIDER_FILTER) continue;
    const datasets = listDirs(path.join(DATA, provider));
    rows.push({
      provider,
      dataset_dirs: datasets.length,
      sample_datasets: datasets.slice(0, 12),
    });
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(DATA)) {
    console.error(`Data root missing: ${DATA}`);
    process.exit(2);
  }

  console.log(`Inventory under ${DATA}`);
  console.log(`Hash verify: ${DO_HASH} (max files/manifest: ${MAX_HASH})`);

  const providers = inventoryProviders();
  const roots = PROVIDER_FILTER
    ? [path.join(DATA, PROVIDER_FILTER)].filter((p) => fs.existsSync(p))
    : providers.map((p) => path.join(DATA, p.provider));

  /** @type {string[]} */
  const manifests = [];
  for (const root of roots) {
    process.stderr.write(`  scanning manifests: ${path.basename(root)}...\n`);
    walkManifests(root, 0, 12, manifests);
  }
  console.log(`Found ${manifests.length} manifest.json`);

  const rows = [];
  let i = 0;
  for (const mp of manifests) {
    i += 1;
    if (i % 25 === 0 || i === manifests.length) {
      process.stderr.write(`  inspected ${i}/${manifests.length}\n`);
    }
    rows.push(inspectManifest(mp));
  }

  const byStatus = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));

  const byProvider = {};
  for (const r of rows) {
    if (!byProvider[r.provider]) {
      byProvider[r.provider] = { manifests: 0, ok: 0, checksum_missing: 0, checksum_mismatch: 0, file_missing: 0, other: 0 };
    }
    byProvider[r.provider].manifests += 1;
    if (r.status === 'ok') byProvider[r.provider].ok += 1;
    else if (r.status === 'checksum_missing') byProvider[r.provider].checksum_missing += 1;
    else if (r.status === 'checksum_mismatch') byProvider[r.provider].checksum_mismatch += 1;
    else if (r.status === 'file_missing') byProvider[r.provider].file_missing += 1;
    else byProvider[r.provider].other += 1;
  }

  const problems = rows.filter((r) => r.status !== 'ok');
  const report = {
    generatedAt: new Date().toISOString(),
    dataRoot: DATA,
    hashVerified: DO_HASH,
    maxHashFilesPerManifest: MAX_HASH,
    providerInventory: providers,
    manifestCount: manifests.length,
    summary: byStatus,
    byProvider,
    problemCount: problems.length,
    problems: problems.slice(0, 500),
    rows,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const header = ['provider', 'dataset', 'status', 'version', 'file_entries', 'hashed_ok', 'total_bytes', 'schema_version', 'note', 'manifest_path'];
  const csv = [
    header.join(','),
    ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');
  fs.writeFileSync(OUT_CSV, `${csv}\n`, 'utf8');

  console.log(JSON.stringify({ summary: byStatus, byProvider, problemCount: problems.length }, null, 2));
  console.log(`Report: ${OUT_JSON}`);
  console.log(`CSV: ${OUT_CSV}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
