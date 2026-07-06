/**
 * Promote classified _review folders to canonical Data/ on Drive.
 *
 * Input: storage/manifests/review-classification.json
 * Skips folders already quarantined (review-quarantine-execute.json).
 *
 *   node scripts/db/review-promote-execute.mjs --batch=promote_kommun_historik
 *   node scripts/db/review-promote-execute.mjs --batch=promote --execute
 *   node scripts/db/review-promote-execute.mjs --batch=all --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CLASSIFY = path.join(ROOT, 'storage', 'manifests', 'review-classification.json');
const QUARANTINE_LOG = path.join(ROOT, 'storage', 'manifests', 'review-quarantine-execute.json');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const REVIEW_PROVIDER = 'OkÃ¤nd_Provider';
const VERSION = '2026-06-22';

const EXECUTE = process.argv.includes('--execute');
const BATCH_ARG = process.argv.find((a) => a.startsWith('--batch='));
const BATCH = BATCH_ARG?.slice('--batch='.length) ?? 'promote_kommun_historik';
const LOG_OUT = path.join(ROOT, 'storage', 'manifests', `review-promote-execute-${BATCH}.json`);

const ALLOWED_ACTIONS = {
  promote_kommun_historik: ['promote_kommun_historik'],
  promote: ['promote'],
  all: ['promote_kommun_historik', 'promote'],
};

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

function buildDestRemote(entry) {
  const folder = entry.folder;
  if (entry.action === 'promote_kommun_historik') {
    return `drive:GEO_Master_Archive/Data/Lantmateriet/KommunHistorik/${folder}/${VERSION}/raw`;
  }
  if (entry.action === 'promote' && entry.provider) {
    return `drive:GEO_Master_Archive/Data/${entry.provider}/${folder}/${VERSION}/raw`;
  }
  throw new Error(`Unsupported action: ${entry.action}`);
}

function main() {
  const actions = ALLOWED_ACTIONS[BATCH];
  if (!actions) {
    console.error(`Unknown --batch=${BATCH}. Use promote_kommun_historik | promote | all`);
    process.exit(1);
  }

  const classify = JSON.parse(fs.readFileSync(CLASSIFY, 'utf8'));
  const quarantined = fs.existsSync(QUARANTINE_LOG)
    ? new Set(JSON.parse(fs.readFileSync(QUARANTINE_LOG, 'utf8')).log.map((l) => l.folder))
    : new Set();

  const rows = classify.allFolders.filter(
    (e) => actions.includes(e.action) && !quarantined.has(e.folder),
  );

  console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} batch=${BATCH}: ${rows.length} folders`);
  console.log(`Total GB: ${rows.reduce((s, e) => s + e.sizeGB, 0).toFixed(2)}\n`);

  const stats = { moved: 0, alreadyMoved: 0, skippedExists: 0, failed: 0 };
  const log = [];

  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i];
    const sourceRemote = `drive:GEO_Master_Archive/_review/${REVIEW_PROVIDER}/${entry.folder}`;
    const destRemote = buildDestRemote(entry);

    if (i % 10 === 0) {
      console.log(`[${i + 1}/${rows.length}] ${entry.folder} (${entry.sizeGB} GB)`);
    }

    if (rclonePathExists(destRemote)) {
      stats.skippedExists++;
      log.push({ folder: entry.folder, destRemote, status: 'skipped_dest_exists' });
      continue;
    }

    if (!EXECUTE) {
      log.push({ folder: entry.folder, sourceRemote, destRemote, status: 'dry_run' });
      continue;
    }

    try {
      const result = rcloneMove(sourceRemote, destRemote);
      if (result === 'already_moved') stats.alreadyMoved++;
      else stats.moved++;
      log.push({ folder: entry.folder, sourceRemote, destRemote, status: result });
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ folder: entry.folder, sourceRemote, destRemote, status: 'failed', error: msg });
      console.error(`  FAILED ${entry.folder}: ${msg.slice(0, 120)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: EXECUTE ? 'execute' : 'dry_run',
    batch: BATCH,
    version: VERSION,
    folderCount: rows.length,
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
