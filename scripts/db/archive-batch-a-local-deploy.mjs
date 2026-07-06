/**
 * Deploy approved Batch A manifest proposals to local GEO_Master_Archive (not Drive).
 * Drive sync may be broken — local H: is canonical until rclone upload succeeds.
 *
 *   node scripts/db/archive-batch-a-local-deploy.mjs --dry-run
 *   node scripts/db/archive-batch-a-local-deploy.mjs --execute
 *   node scripts/db/archive-batch-a-local-deploy.mjs --execute --cleanup
 */
import fs from 'fs';
import path from 'path';
import { ensureArchiveManifestV2, validateArchiveManifestStructure } from '../import/types/manifestSchema.mjs';

const ROOT = process.cwd();
const MASTER = process.env.GEO_MASTER_ARCHIVE
  ?? 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const CSV_PATH = path.join(ROOT, 'storage/manifests/manifest-audit-proposals-2026-06-22.csv');
const PROPOSALS_DIR = path.join(ROOT, 'storage/manifests/manifest-proposals/2026-06-22');
const ARCHIVE_OPS = path.join(MASTER, '_ops', 'batch-a-manifest-audit-2026-06-22');

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const CLEANUP = process.argv.includes('--cleanup');

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

function main() {
  if (!EXECUTE && !DRY_RUN) {
    console.error('Use --dry-run or --execute');
    process.exit(1);
  }
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing CSV: ${CSV_PATH}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  const headers = parseCsvRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  let deployed = 0;
  let skipped = 0;
  let already = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    if (String(vals[idx.approved]).toLowerCase() !== 'true') {
      skipped++;
      continue;
    }
    const localPath = vals[idx.proposal_local];
    const manifestRel = vals[idx.manifest_rel];
    if (!localPath || !manifestRel || !fs.existsSync(localPath)) {
      skipped++;
      continue;
    }

    const targetPath = path.join(DATA, manifestRel.replace(/\//g, path.sep));
    const targetDir = path.dirname(targetPath);

    if (fs.existsSync(targetPath)) {
      already++;
      continue;
    }

    if (!fs.existsSync(targetDir)) {
      errors.push({ row: i, manifestRel, reason: 'target version dir missing on disk' });
      skipped++;
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const manifest = ensureArchiveManifestV2(raw);
    const validated = validateArchiveManifestStructure(manifest);
    if (!validated.ok) {
      errors.push({ row: i, manifestRel, reason: validated.errors.join('; ') });
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      deployed++;
      continue;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, `${JSON.stringify(validated.manifest, null, 2)}\n`, 'utf8');
    deployed++;
  }

  const result = { mode: DRY_RUN ? 'dry-run' : 'execute', deployed, already, skipped, errors: errors.slice(0, 20), errorCount: errors.length };
  console.log(JSON.stringify(result, null, 2));

  if (EXECUTE && !DRY_RUN) {
    fs.mkdirSync(ARCHIVE_OPS, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(CSV_PATH, path.join(ARCHIVE_OPS, `manifest-audit-proposals-${stamp}.csv`));
    const logPath = path.join(ARCHIVE_OPS, `deploy-result-${stamp}.json`);
    fs.writeFileSync(logPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`Archived CSV/log to ${ARCHIVE_OPS}`);
  }

  if (CLEANUP && EXECUTE && !DRY_RUN && errors.length === 0) {
    if (fs.existsSync(PROPOSALS_DIR)) {
      fs.rmSync(PROPOSALS_DIR, { recursive: true, force: true });
      console.log(`Removed local proposals: ${PROPOSALS_DIR}`);
    }
    const bak = `${CSV_PATH}.pre-execute.bak`;
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
  }
}

main();
