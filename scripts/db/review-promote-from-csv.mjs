/**
 * Promote/quarantine _review folders from approved CSV rows (rclone moveto).
 *
 *   node scripts/db/review-promote-from-csv.mjs
 *   node scripts/db/review-promote-from-csv.mjs --execute
 *   node scripts/db/review-promote-from-csv.mjs --execute --csv=path/to.csv
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DEFAULT_CSV = path.join(ROOT, 'storage/manifests/review-manual-review-proposal.csv');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const REVIEW_PROVIDER = 'OkÃ¤nd_Provider';
const VERSION = '2026-06-22';

const EXECUTE = process.argv.includes('--execute');
const CSV_ARG = process.argv.find((a) => a.startsWith('--csv='));
const CSV_PATH = CSV_ARG ? path.resolve(CSV_ARG.slice('--csv='.length)) : DEFAULT_CSV;
const LOG_ARG = process.argv.find((a) => a.startsWith('--log-out='));
const LOG_OUT = LOG_ARG
  ? path.resolve(LOG_ARG.slice('--log-out='.length))
  : path.join(ROOT, 'storage/manifests/review-promote-from-csv.json');

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

function loadApprovedRows() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = parseCsvRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    const row = Object.fromEntries(headers.map((h, idx) => [h, vals[idx] ?? '']));
    if (String(row.approved).toLowerCase() === 'true') rows.push(row);
  }
  return rows;
}

function isAlreadyMovedError(err) {
  const blob = [err?.message, err?.stderr, err?.stdout].filter(Boolean).join('\n');
  return /source doesn't exist|doesn't exist or is a directory|object not found|couldn't find file|directory not found|didn't find section/i.test(blob);
}

function rclonePathExists(remotePath) {
  try {
    execFileSync(
      'docker',
      [
        'run', '--rm',
        '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
        'rclone/rclone',
        'lsf', remotePath,
        '--config', '/config/rclone/rclone.conf',
        '--max-depth', '1',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return true;
  } catch {
    return false;
  }
}

function rcloneMove(sourceRemote, destRemote, { retries = 3 } = {}) {
  const dockerArgs = [
    'run', '--rm',
    '-v', `${RCLONE_CONFIG}:/config/rclone:ro`,
    'rclone/rclone',
    'moveto', sourceRemote, destRemote,
    '--log-level', 'INFO',
    '--config', '/config/rclone/rclone.conf',
  ];
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const stdout = execFileSync('docker', dockerArgs, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      if (stdout) process.stdout.write(stdout);
      return 'moved';
    } catch (err) {
      lastErr = err;
      if (err.stdout) process.stdout.write(err.stdout);
      if (err.stderr) process.stderr.write(err.stderr);
      if (isAlreadyMovedError(err)) return 'already_moved';
      if (attempt < retries) {
        const waitSec = attempt * 15;
        console.warn(`  retry ${attempt}/${retries} in ${waitSec}s...`);
        execFileSync('powershell', ['-Command', `Start-Sleep -Seconds ${waitSec}`], { stdio: 'ignore' });
      }
    }
  }
  throw lastErr;
}

function buildDestRemote(row) {
  const folder = row.folder;
  const action = row.suggested_action;
  if (action === 'quarantine') {
    return `drive:GEO_Master_Archive/_quarantine/admin_non_geodata_${VERSION}_from_review/${folder}`;
  }
  if (action === 'promote_kommun') {
    return `drive:GEO_Master_Archive/Data/Lantmateriet/KommunHistorik/${folder}/${VERSION}/raw`;
  }
  if (action === 'promote') {
    if (!row.suggested_provider) throw new Error('promote row missing suggested_provider');
    return `drive:GEO_Master_Archive/Data/${row.suggested_provider}/${folder}/${VERSION}/raw`;
  }
  throw new Error(`Unsupported suggested_action: ${action}`);
}

function main() {
  const rows = loadApprovedRows();
  const promote = rows.filter((r) => r.suggested_action === 'promote' || r.suggested_action === 'promote_kommun');
  const quarantine = rows.filter((r) => r.suggested_action === 'quarantine');
  const totalGb = rows.reduce((s, r) => s + Number(r.size_gb || 0), 0);

  console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} from ${CSV_PATH}`);
  console.log(`Approved: ${rows.length} (${promote.length} promote, ${quarantine.length} quarantine)`);
  console.log(`Total GB: ${totalGb.toFixed(2)}\n`);

  const stats = { moved: 0, alreadyMoved: 0, skippedExists: 0, failed: 0 };
  const log = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sourceRemote = `drive:GEO_Master_Archive/_review/${REVIEW_PROVIDER}/${row.folder}`;
    const destRemote = buildDestRemote(row);

    if (i % 20 === 0) {
      console.log(`[${i + 1}/${rows.length}] ${row.folder} (${row.suggested_action})`);
    }

    if (rclonePathExists(destRemote)) {
      stats.skippedExists++;
      log.push({ folder: row.folder, action: row.suggested_action, destRemote, status: 'skipped_dest_exists' });
      continue;
    }

    if (!EXECUTE) {
      log.push({ folder: row.folder, sourceRemote, destRemote, action: row.suggested_action, status: 'dry_run' });
      continue;
    }

    try {
      const result = rcloneMove(sourceRemote, destRemote);
      if (result === 'already_moved') stats.alreadyMoved++;
      else stats.moved++;
      log.push({
        folder: row.folder,
        sourceRemote,
        destRemote,
        action: row.suggested_action,
        status: result,
      });
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log.push({
        folder: row.folder,
        sourceRemote,
        destRemote,
        action: row.suggested_action,
        status: 'failed',
        error: msg,
      });
      console.error(`  FAILED ${row.folder}: ${msg.slice(0, 120)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: EXECUTE ? 'execute' : 'dry_run',
    csvPath: CSV_PATH,
    version: VERSION,
    approvedCount: rows.length,
    stats,
    log,
  };

  fs.mkdirSync(path.dirname(LOG_OUT), { recursive: true });
  fs.writeFileSync(LOG_OUT, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\nLog: ${LOG_OUT}`);
  console.log(JSON.stringify(stats, null, 2));

  if (EXECUTE && stats.failed > 0) process.exit(1);
}

main();
