/**
 * Read-only SHA-256 comparison: migration staging vs canonical GEO_Master_Archive/Data.
 *
 * Canonical index: rclone hashsum SHA256 via Drive (H: placeholders are not readable).
 * Migration side: local staging with dev/json excludes.
 *
 * Run: node scripts/db/migration-hash-compare.mjs
 * Output: storage/manifests/migration_hash_compare.json
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const STAGING = path.join(ROOT, 'storage', 'migration_staging', '2026-06-19');
const MIGRATION_DATA = path.join(STAGING, 'Data', '_migration_from_D', '2026-06-19');
const MIGRATION_DOCS = path.join(STAGING, 'Documents', 'Sources', '_migration_from_D', '2026-06-19');
const OUT = path.join(ROOT, 'storage', 'manifests', 'migration_hash_compare.json');
const CACHE = path.join(ROOT, 'storage', 'manifests', 'canonical_sha256_index.json');
const EXECUTED = path.join(ROOT, 'storage', 'manifests', 'D_to_H_migration_executed.json');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');

const CANONICAL_PROVIDERS = [
  'SGU', 'LM', 'Lantmateriet', 'MSB', 'Naturvardsverket', 'Gbg_Luftkvalitet', 'VISS', 'SMED', 'LST',
];

const EXCLUDE_DIR = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'dist', '.next', 'metadata',
]);
const EXCLUDE_EXT = new Set(['.json']);
const GEODATA_EXT = new Set([
  '.tif', '.tiff', '.gpkg', '.shp', '.zip', '.gdb', '.geojson', '.pdf',
  '.docx', '.doc', '.xlsx', '.csv',
]);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    hash.update(buf.subarray(0, bytes));
  }
  fs.closeSync(fd);
  return hash.digest('hex');
}

function rcloneHashsum(provider) {
  const remotePath = `drive:GEO_Master_Archive/Data/${provider}`;
  const args = [
    'run', '--rm',
    '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
    'rclone/rclone',
    'hashsum', 'SHA256', remotePath,
    '--fast-list',
    '--download',
  ];
  const out = execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
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
    relPath = `${provider}/${relPath.replace(/\\/g, '/')}`;
    rows.push({ hash, size, relPath });
  }
  return rows;
}

function buildCanonicalIndex({ useCache = true } = {}) {
  if (useCache && fs.existsSync(CACHE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (cached.version === 1 && cached.byHash) {
      console.log(`Using cached canonical index (${cached.fileCount} files)`);
      return {
        byHash: new Map(Object.entries(cached.byHash)),
        bySize: new Map(Object.entries(cached.bySize).map(([k, v]) => [Number(k), v])),
        fileCount: cached.fileCount,
        unreadable: cached.unreadable ?? [],
      };
    }
  }

  /** @type {Map<string, { path: string, size: number }[]>} */
  const byHash = new Map();
  /** @type {Map<number, { path: string, hash: string }[]>} */
  const bySize = new Map();
  let fileCount = 0;

  for (const provider of CANONICAL_PROVIDERS) {
    console.log(`rclone hashsum ${provider}...`);
    let rows;
    try {
      rows = rcloneHashsum(provider);
    } catch (err) {
      console.warn(`  skip ${provider}: ${err.message}`);
      continue;
    }
    for (const row of rows) {
      fileCount++;
      const canonicalPath = row.relPath.replace(/\\/g, '/');
      if (!byHash.has(row.hash)) byHash.set(row.hash, []);
      byHash.get(row.hash).push({ path: canonicalPath, size: row.size });
      const sizeKey = row.size || 0;
      if (!bySize.has(sizeKey)) bySize.set(sizeKey, []);
      bySize.get(sizeKey).push({ path: canonicalPath, hash: row.hash });
    }
    console.log(`  ${provider}: ${rows.length} files hashed`);
  }

  const cachePayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fileCount,
    byHash: Object.fromEntries(byHash),
    bySize: Object.fromEntries([...bySize.entries()].map(([k, v]) => [String(k), v])),
    unreadable: [],
  };
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cachePayload), 'utf8');
  console.log(`Cached canonical index: ${CACHE}`);
  return { byHash, bySize, fileCount, unreadable: [] };
}

function shouldSkip(relPath, fileName) {
  const parts = relPath.split(/[/\\]/);
  if (parts.some((p) => EXCLUDE_DIR.has(p.toLowerCase()))) return true;
  const ext = path.extname(fileName).toLowerCase();
  if (EXCLUDE_EXT.has(ext)) return true;
  if (fileName.includes('.tmp.driveupload')) return true;
  return false;
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIR.has(entry.name.toLowerCase())) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, full);
        if (shouldSkip(rel, entry.name)) continue;
        try {
          const stat = fs.statSync(full);
          files.push({ rel, full, size: stat.size });
        } catch {
          // skip unreadable
        }
      }
    }
  }
  return files;
}

function loadExecutedHashes() {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!fs.existsSync(EXECUTED)) return map;
  const data = JSON.parse(fs.readFileSync(EXECUTED, 'utf8'));
  for (const item of data.fileManifest ?? []) {
    if (item.destPath && item.sha256) map.set(path.normalize(item.destPath), item.sha256);
  }
  return map;
}

function classifyMigrationFile(f, canonical, executedHashes) {
  const ext = path.extname(f.full).toLowerCase();
  const category = GEODATA_EXT.has(ext) ? 'geodata_or_doc' : 'other';
  let hash = executedHashes.get(path.normalize(f.full));
  if (!hash) {
    try {
      hash = sha256File(f.full);
    } catch (err) {
      return {
        rel: f.rel.replace(/\\/g, '/'),
        size: f.size,
        category,
        verdict: 'unreadable',
        error: err.message,
      };
    }
  }

  const canonicalMatches = canonical.byHash.get(hash) ?? [];
  if (canonicalMatches.length > 0) {
    return {
      rel: f.rel.replace(/\\/g, '/'),
      size: f.size,
      sha256: hash,
      category,
      verdict: 'verified_duplicate',
      canonicalPaths: canonicalMatches.map((m) => m.path),
    };
  }

  const sizeMatches = (canonical.bySize.get(f.size) ?? []).filter((m) => m.hash !== hash);
  if (sizeMatches.length > 0) {
    return {
      rel: f.rel.replace(/\\/g, '/'),
      size: f.size,
      sha256: hash,
      category,
      verdict: 'same_size_different_content',
      sizeCollisionPaths: sizeMatches.slice(0, 3).map((m) => m.path),
    };
  }

  return {
    rel: f.rel.replace(/\\/g, '/'),
    size: f.size,
    sha256: hash,
    category,
    verdict: 'unique_new',
    canonicalPaths: [],
  };
}

function summarizeBySource(results) {
  /** @type {Record<string, object>} */
  const bySource = {};
  for (const r of results) {
    const source = r.rel.split('/')[0] ?? 'unknown';
    if (!bySource[source]) {
      bySource[source] = {
        duplicate: 0, unique: 0, sizeCollision: 0, unreadable: 0,
        bytesDuplicate: 0, bytesUnique: 0,
      };
    }
    const bucket = bySource[source];
    if (r.verdict === 'verified_duplicate') {
      bucket.duplicate++;
      bucket.bytesDuplicate += r.size;
    } else if (r.verdict === 'unique_new') {
      bucket.unique++;
      bucket.bytesUnique += r.size;
    } else if (r.verdict === 'unreadable') {
      bucket.unreadable++;
    } else {
      bucket.sizeCollision++;
    }
  }
  return bySource;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('Building canonical SHA-256 index from Drive (rclone)...');
  const canonical = buildCanonicalIndex({ useCache: false });
  console.log(`Canonical index: ${canonical.fileCount} files, ${canonical.byHash.size} unique hashes`);

  const executedHashes = loadExecutedHashes();
  console.log(`Pre-computed migration hashes: ${executedHashes.size}`);

  /** @type {Record<string, object>} */
  const sections = {};

  for (const [label, root] of [
    ['migration_data', MIGRATION_DATA],
    ['migration_docs', MIGRATION_DOCS],
  ]) {
    if (!fs.existsSync(root)) {
      console.log(`Skip missing: ${root}`);
      continue;
    }
    const files = walkFiles(root);
    console.log(`\nHashing ${label}: ${files.length} files...`);
    const results = [];
    let i = 0;
    for (const f of files) {
      i++;
      if (i % 25 === 0 || i === files.length) {
        process.stdout.write(`\r${label} ${i}/${files.length}...`);
      }
      results.push(classifyMigrationFile(f, canonical, executedHashes));
    }
    process.stdout.write('\n');

    const duplicates = results.filter((r) => r.verdict === 'verified_duplicate');
    const unique = results.filter((r) => r.verdict === 'unique_new');
    const collisions = results.filter((r) => r.verdict === 'same_size_different_content');
    const geodataUnique = unique.filter((r) => r.category === 'geodata_or_doc');

    sections[label] = {
      root,
      scannedFiles: files.length,
      summary: {
        verifiedDuplicates: duplicates.length,
        verifiedDuplicateGB: Number((duplicates.reduce((s, r) => s + r.size, 0) / 1024 ** 3).toFixed(2)),
        uniqueNew: unique.length,
        uniqueNewGB: Number((unique.reduce((s, r) => s + r.size, 0) / 1024 ** 3).toFixed(2)),
        uniqueGeodataOrDoc: geodataUnique.length,
        uniqueGeodataOrDocGB: Number((geodataUnique.reduce((s, r) => s + r.size, 0) / 1024 ** 3).toFixed(2)),
        sizeCollisions: collisions.length,
        unreadable: results.filter((r) => r.verdict === 'unreadable').length,
      },
      bySource: summarizeBySource(results),
      topUniqueGeodata: geodataUnique
        .sort((a, b) => b.size - a.size)
        .slice(0, 40)
        .map(({ rel, size, sha256 }) => ({
          rel, sizeGB: Number((size / 1024 ** 3).toFixed(3)), sha256,
        })),
      topDuplicates: duplicates
        .sort((a, b) => b.size - a.size)
        .slice(0, 25)
        .map(({ rel, size, canonicalPaths }) => ({
          rel, sizeGB: Number((size / 1024 ** 3).toFixed(3)), canonicalPaths,
        })),
    };
  }

  const dataDupGB = sections.migration_data?.summary.verifiedDuplicateGB ?? 0;
  const dataUniqueGeoGB = sections.migration_data?.summary.uniqueGeodataOrDocGB ?? 0;
  const docsUniqueGeoGB = sections.migration_docs?.summary.uniqueGeodataOrDocGB ?? 0;

  const report = {
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    mode: 'read_only_full_sha256',
    canonicalSource: 'drive:GEO_Master_Archive/Data/<Provider> via rclone hashsum',
    canonicalFileCount: canonical.fileCount,
    canonicalUniqueHashes: canonical.byHash.size,
    stagingRoot: STAGING,
    excludes: [...EXCLUDE_DIR, ...[...EXCLUDE_EXT].map((e) => `*${e}`)],
    sections,
    recommendation: {
      promoteGB: Number((dataUniqueGeoGB + docsUniqueGeoGB).toFixed(2)),
      quarantineDuplicateGB: dataDupGB,
      note: 'Promote unique geodata/docs to canonical provider paths; quarantine verified duplicates and dev junk.',
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport: ${OUT}`);
  console.log(JSON.stringify({
    canonical: { files: report.canonicalFileCount, uniqueHashes: report.canonicalUniqueHashes },
    migration_data: sections.migration_data?.summary,
    migration_docs: sections.migration_docs?.summary,
    recommendation: report.recommendation,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
