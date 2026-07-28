/**
 * Repair manifests that have files but lack files_detail/SHA-256 receipts.
 * Reads the local verify report, finds checksum_missing rows, hashes each
 * file listed in manifest.files, and writes files_detail back into the manifest.
 *
 *   node scripts/db/archive-repair-files-detail.mjs --dry-run
 *   node scripts/db/archive-repair-files-detail.mjs --execute
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureArchiveManifestV2, validateArchiveManifestStructure } from '../import/types/manifestSchema.mjs';

const ROOT = process.cwd();
const REPORT = path.join(ROOT, 'storage/manifests/archive-local-verify-registry.json');

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

/**
 * SHA-256 via Windows Get-FileHash (pwsh) or certutil — Node createReadStream throws EISDIR
 * on online-only Google Drive (H:) files; native tools trigger hydration.
 */
async function sha256File(filePath) {
  const psPath = filePath.replace(/'/g, "''");

  const tryPwsh = () => {
    const out = execFileSync(
      'pwsh',
      ['-NoProfile', '-Command', `(Get-FileHash -Algorithm SHA256 -LiteralPath '${psPath}').Hash`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    return out.trim().toLowerCase();
  };

  const tryCertutil = () => {
    const out = execFileSync('certutil', ['-hashfile', filePath, 'SHA256'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const line = out.split(/\r?\n/).find((l) => /^[0-9a-f]{64}$/i.test(l.trim()));
    if (!line) throw new Error(`certutil parse failed for ${filePath}`);
    return line.trim().toLowerCase();
  };

  let hash;
  try {
    hash = tryPwsh();
  } catch {
    try {
      hash = tryCertutil();
    } catch (err) {
      throw new Error(`sha256 failed for ${filePath}: ${err.message}`);
    }
  }

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`unexpected hash output for ${filePath}: ${hash.slice(0, 80)}`);
  }
  return hash;
}

function bundleHash(detail) {
  const parts = detail.map((d) => `${d.name}:${d.sha256}`).sort();
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Resolve a manifest `files[]` entry to a real file on disk relative to the manifest dir. */
function resolveFile(manifestDir, relEntry) {
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

async function repair(row) {
  const manifestPath = row.manifest_path;
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return { dataset: row.dataset, status: 'error', note: `manifest missing: ${manifestPath}` };
  }
  const manifestDir = path.dirname(manifestPath);
  const manifest = ensureArchiveManifestV2(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) {
    return { dataset: row.dataset, status: 'error', note: 'manifest.files empty' };
  }

  /** @type {Array<{ name: string, sha256: string, size_bytes: number, rel_path: string }>} */
  const detail = [];
  let totalBytes = 0;
  for (const rel of files) {
    const filePath = resolveFile(manifestDir, rel);
    if (!filePath) {
      return { dataset: row.dataset, status: 'error', note: `file not found on disk: ${rel}` };
    }
    const size = fs.statSync(filePath).size;
    const hash = await sha256File(filePath);
    totalBytes += size;
    detail.push({
      name: path.basename(filePath),
      sha256: hash,
      size_bytes: size,
      rel_path: rel.replace(/\\/g, '/'),
    });
  }

  const updated = {
    ...manifest,
    total_bytes: manifest.total_bytes || totalBytes,
    files_detail: detail,
    content_bundle_sha256: manifest.content_bundle_sha256 || bundleHash(detail),
    qa_at: new Date().toISOString(),
  };

  const validated = validateArchiveManifestStructure(updated);
  if (!validated.ok) {
    return { dataset: row.dataset, status: 'error', note: `invalid after repair: ${validated.errors.join('; ')}` };
  }

  if (DRY_RUN) {
    return {
      dataset: row.dataset,
      status: 'dry-run',
      note: `would write ${detail.length} files_detail entries`,
      hashes: detail.map((d) => `${d.name}=${d.sha256.slice(0, 12)}…`),
    };
  }

  // Write back to both version-level and raw-level manifest if both exist.
  const manifestJson = `${JSON.stringify(validated.manifest, null, 2)}\n`;
  fs.copyFileSync(manifestPath, `${manifestPath}.pre-repair.bak`);
  fs.writeFileSync(manifestPath, manifestJson, 'utf8');

  const siblingRawManifest = path.join(manifestDir, 'raw', 'manifest.json');
  const parentManifest = path.join(path.dirname(manifestDir), 'manifest.json');
  for (const sibling of [siblingRawManifest, parentManifest]) {
    if (sibling !== manifestPath && fs.existsSync(sibling)) {
      fs.writeFileSync(sibling, manifestJson, 'utf8');
    }
  }

  return {
    dataset: row.dataset,
    status: 'repaired',
    note: `wrote ${detail.length} files_detail entries (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
    manifest: manifestPath,
  };
}

async function main() {
  if (!DRY_RUN && !EXECUTE) {
    console.error('Use --dry-run or --execute');
    process.exit(1);
  }
  if (!fs.existsSync(REPORT)) {
    console.error(`Run archive-local-verify-registry.mjs first (missing ${REPORT})`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const targets = report.rows.filter((r) => r.status === 'checksum_missing');
  console.log(`Repairing ${targets.length} checksum_missing datasets...`);

  const results = [];
  for (const row of targets) {
    process.stderr.write(`  ${row.provider}/${row.dataset}...`);
    const r = await repair(row);
    results.push(r);
    process.stderr.write(` ${r.status}\n`);
  }
  console.log(JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'execute', results }, null, 2));
  if (results.some((r) => r.status === 'error')) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
