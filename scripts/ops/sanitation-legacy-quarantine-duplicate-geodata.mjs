/**
 * SAN-2026-008 — quarantine D_GEodata duplicate remnant (4 files).
 *   node scripts/ops/sanitation-legacy-quarantine-duplicate-geodata.mjs --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DRY = !process.argv.includes('--execute');
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const VERSION = '2026-06-19';
const srcRel = `Data/_migration_from_D/${VERSION}/D_GEodata`;
const src = path.join(MASTER, srcRel);
const qroot = path.join(MASTER, '_quarantine', `legacy_migration_duplicate_${VERSION}`);
const dest = path.join(qroot, 'D_GEodata');
const OPS = path.join(MASTER, '_ops', 'sanitation');
const REPO = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function walkFiles(d, rel = '', out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkFiles(fp, r, out);
    else out.push({ path: r, size: fs.statSync(fp).size });
  }
  return out;
}

if (!fs.existsSync(src)) {
  console.log(JSON.stringify({ status: 'skipped_missing', source: srcRel }, null, 2));
  process.exit(0);
}

const files = walkFiles(src);
const destRel = path.relative(MASTER, dest).replace(/\\/g, '/');

if (DRY) {
  console.log(JSON.stringify({ dry_run: true, source: srcRel, target: destRel, files }, null, 2));
  process.exit(0);
}

fs.mkdirSync(qroot, { recursive: true });
if (fs.existsSync(dest)) throw new Error(`destination exists: ${dest}`);
try {
  fs.renameSync(src, dest);
} catch {
  execFileSync(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      `Move-Item -LiteralPath '${src.replace(/'/g, "''")}' -Destination '${dest.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );
}

const artifact = {
  schema_version: '1.0',
  operation_id: 'SAN-2026-008',
  action: 'MOVE',
  reason: 'legacy_migration',
  source: srcRel,
  target: destRel,
  provider: '_migration_from_D',
  dataset: VERSION,
  files: files.length,
  old_hashes: [],
  new_hashes: [],
  classification: 'duplicate',
  approved_by: 'governance',
  created_at: new Date().toISOString(),
  closed_at: new Date().toISOString(),
  status: 'completed',
  notes:
    'Near-empty D_GEodata remnant (Historiska crumbs + qlr/lyrx). '
    + 'Canonical remains Data/LM/Historiska. Coverage diff trivial — 4 files only.',
  related_operation_ids: ['SAN-2026-005', 'SAN-2026-006'],
  evidence: {
    file_list: files,
    canonical_hint: 'Data/LM/Historiska/Haradsekonomiska_kartan',
  },
};

writeJson(path.join(REPO, 'SAN-2026-008.json'), artifact);
writeJson(path.join(OPS, 'SAN-2026-008.json'), artifact);
console.log(JSON.stringify({ status: 'completed', files: files.length, target: destRel, files_detail: files }, null, 2));
