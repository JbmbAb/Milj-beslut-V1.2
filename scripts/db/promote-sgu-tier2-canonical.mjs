/**
 * Promote SGU Tier 2 datasets from repo staging into canonical
 * GEO_Master_Archive/Data/SGU/<Dataset>/<version>/raw/ with a full v2 manifest
 * (files_detail + SHA-256), mirroring the verified Jordskred layout.
 *
 *   node scripts/db/promote-sgu-tier2-canonical.mjs --dry-run
 *   node scripts/db/promote-sgu-tier2-canonical.mjs --execute
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildArchiveManifestV2, validateArchiveManifestStructure } from '../import/types/manifestSchema.mjs';

const ROOT = process.cwd();
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const STAGING = path.join(ROOT, 'storage', 'manifests');
const VERSION = '2026-06-26';

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

const DATASETS = [
  {
    dataset: 'StranderosionAktiv',
    stagingDir: 'sgu-stranderosionkust-zip',
    primaryGpkg: 'stranderosion_kust.gpkg',
    source_url: 'https://resource.sgu.se/data/oppnadata/stranderosion-kust/stranderosion-kust.zip',
    license: 'CC BY 4.0',
    expected_columns: ['sl', 'sl_tx'],
  },
  {
    dataset: 'Jordarter750kBlockighet',
    stagingDir: 'sgu-jordarter750kblockighet-zip',
    primaryGpkg: 'jordarter750k.gpkg',
    source_url: 'https://resource.sgu.se/data/oppnadata/jordarter750k/jordarter750k.zip',
    license: 'CC BY 4.0',
    expected_columns: ['bl', 'bl_tx'],
  },
  {
    dataset: 'Jordarter750kLandform',
    stagingDir: 'sgu-jordarter750klandform-zip',
    primaryGpkg: 'jordarter750k.gpkg',
    source_url: 'https://resource.sgu.se/data/oppnadata/jordarter750k/jordarter750k.zip',
    license: 'CC BY 4.0',
    expected_columns: ['lf', 'lf_tx'],
  },
];

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function bundleHash(detail) {
  const parts = detail.map((d) => `${d.name}:${d.sha256}`).sort();
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function listRealFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listRealFiles(fp));
    else if (e.isFile() && fs.statSync(fp).size > 0) out.push(fp);
  }
  return out;
}

async function promote(entry) {
  const srcRaw = path.join(STAGING, entry.stagingDir, 'raw');
  if (!fs.existsSync(srcRaw)) {
    return { dataset: entry.dataset, status: 'error', note: `staging raw missing: ${srcRaw}` };
  }
  const srcGpkg = path.join(srcRaw, 'extracted', entry.primaryGpkg);
  if (!fs.existsSync(srcGpkg)) {
    return { dataset: entry.dataset, status: 'error', note: `primary gpkg missing: ${srcGpkg}` };
  }

  const destVersionDir = path.join(DATA, 'SGU', entry.dataset, VERSION);
  const destRaw = path.join(destVersionDir, 'raw');

  if (fs.existsSync(path.join(destVersionDir, 'manifest.json'))) {
    return { dataset: entry.dataset, status: 'already', note: `canonical manifest already exists at ${destVersionDir}` };
  }

  const gpkgHash = await sha256File(srcGpkg);
  const gpkgSize = fs.statSync(srcGpkg).size;
  const relPrimary = `extracted/${entry.primaryGpkg}`;

  const filesToCopy = listRealFiles(srcRaw).filter((f) => {
    const base = path.basename(f).toLowerCase();
    return base !== 'manifest.json';
  });
  const totalBytes = filesToCopy.reduce((s, f) => s + fs.statSync(f).size, 0);

  const manifest = buildArchiveManifestV2({
    provider: 'SGU',
    dataset: entry.dataset,
    version: VERSION,
    total_bytes: totalBytes,
    files: [relPrimary],
    content_bundle_sha256: bundleHash([{ name: entry.primaryGpkg, sha256: gpkgHash }]),
    provenance: 'sgu_official_zip',
    source_url: entry.source_url,
    license: entry.license,
    qa_status: 'pending',
    expected_columns: entry.expected_columns,
    files_detail: [{
      name: entry.primaryGpkg,
      sha256: gpkgHash,
      size_bytes: gpkgSize,
      rel_path: relPrimary,
    }],
  });

  const validated = validateArchiveManifestStructure(manifest);
  if (!validated.ok) {
    return { dataset: entry.dataset, status: 'error', note: `invalid manifest: ${validated.errors.join('; ')}` };
  }

  if (DRY_RUN) {
    return {
      dataset: entry.dataset,
      status: 'dry-run',
      note: `would copy ${filesToCopy.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) to ${destRaw}`,
      gpkg_sha256: gpkgHash,
    };
  }

  fs.mkdirSync(destRaw, { recursive: true });
  for (const f of filesToCopy) {
    const rel = path.relative(srcRaw, f);
    const dest = path.join(destRaw, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
  }

  const manifestJson = `${JSON.stringify(validated.manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(destVersionDir, 'manifest.json'), manifestJson, 'utf8');
  fs.writeFileSync(path.join(destRaw, 'manifest.json'), manifestJson, 'utf8');

  return {
    dataset: entry.dataset,
    status: 'promoted',
    note: `copied ${filesToCopy.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
    dest: destVersionDir,
    gpkg_sha256: gpkgHash,
  };
}

async function main() {
  if (!DRY_RUN && !EXECUTE) {
    console.error('Use --dry-run or --execute');
    process.exit(1);
  }
  const results = [];
  for (const entry of DATASETS) {
    process.stderr.write(`  ${entry.dataset}...`);
    const r = await promote(entry);
    results.push(r);
    process.stderr.write(` ${r.status}\n`);
  }
  console.log(JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'execute', version: VERSION, results }, null, 2));
  if (results.some((r) => r.status === 'error')) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
