/** Retry H: sync from local staging. Run: node scripts/db/migrate-d-to-h-sync-h.mjs */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const STAGING = path.join(process.cwd(), 'storage', 'migration_staging', '2026-06-19');
const STAGING_DATA = path.join(STAGING, 'Data', '_migration_from_D', '2026-06-19');
const STAGING_DOCS = path.join(STAGING, 'Documents', 'Sources', '_migration_from_D', '2026-06-19');
const MANIFEST_LOCAL = path.join(process.cwd(), 'storage', 'manifests', 'D_to_H_migration_executed.json');

function resolveHRoot() {
  const base = 'H:\\Delade enheter';
  const hit = fs.readdirSync(base).find((d) => d.includes('Milj') && d.includes('beslut'));
  if (!hit) throw new Error('H: Miljöbeslut folder not found');
  return path.join(base, hit);
}

function robocopy(src, dest, tag) {
  console.log(`[${tag}] ${src} -> ${dest}`);
  if (!fs.existsSync(src)) {
    console.log(`[${tag}] skip: source missing`);
    return { ok: true, skipped: true };
  }
  const logFile = path.join(process.cwd(), 'storage', 'manifests', `${tag}.log`);
  const result = spawnSync(
    'robocopy',
    [src, dest, '/E', '/COPY:DAT', '/R:3', '/W:10', '/MT:4', `/LOG:${logFile}`, '/NP'],
    { encoding: 'utf8' },
  );
  const code = result.status ?? 0;
  const ok = code >= 0 && code < 8;
  console.log(`[${tag}] exit=${code} ok=${ok}`);
  return { ok, exitCode: code, logFile };
}

const hRoot = resolveHRoot();
const master = path.join(hRoot, 'GEO_Master_Archive');
const hData = path.join(master, 'Data', '_migration_from_D', '2026-06-19');
const hDocs = path.join(master, 'Documents', 'Sources', '_migration_from_D', '2026-06-19');

console.log('H root:', hRoot);
const dataSync = robocopy(STAGING_DATA, hData, 'h-sync-retry-data');
const docsSync = robocopy(STAGING_DOCS, hDocs, 'h-sync-retry-docs');

if (fs.existsSync(MANIFEST_LOCAL)) {
  const hManifest = path.join(master, '_manifests', 'D_to_H_migration_executed.json');
  fs.mkdirSync(path.dirname(hManifest), { recursive: true });
  fs.copyFileSync(MANIFEST_LOCAL, hManifest);
  console.log('Manifest copied to', hManifest);
}

console.log(JSON.stringify({ dataSync, docsSync }, null, 2));
