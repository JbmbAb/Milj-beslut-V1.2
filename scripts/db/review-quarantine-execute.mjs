/**
 * Move verified _review duplicates to _quarantine on Drive (rclone moveto).
 *
 * Input: storage/manifests/review-dedupe-full-hash.json
 *
 *   node scripts/db/review-quarantine-execute.mjs           # dry-run
 *   node scripts/db/review-quarantine-execute.mjs --execute
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HASH_REPORT = path.join(ROOT, 'storage', 'manifests', 'review-dedupe-full-hash.json');
const LOG_OUT = path.join(ROOT, 'storage', 'manifests', 'review-quarantine-execute.json');
const RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
const REVIEW_PROVIDER = 'OkÃ¤nd_Provider';
const VERSION = '2026-06-22';
const QUARANTINE_BASE = `drive:GEO_Master_Archive/_quarantine/duplicate_verified_${VERSION}_from_review`;

const EXECUTE = process.argv.includes('--execute');

function isAlreadyMovedError(err) {
  const blob = [err?.message, err?.stderr, err?.stdout].filter(Boolean).join('\n');
  return /source doesn't exist|doesn't exist or is a directory|object not found|couldn't find file|directory not found|didn't find section/i.test(blob);
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
      if (isAlreadyMovedError(err)) {
        console.warn(`  already moved: ${path.basename(sourceRemote)}`);
        return 'already_moved';
      }
      if (attempt < retries) {
        const waitSec = attempt * 15;
        console.warn(`  retry ${attempt}/${retries} in ${waitSec}s...`);
        execFileSync('powershell', ['-Command', `Start-Sleep -Seconds ${waitSec}`], { stdio: 'ignore' });
      }
    }
  }
  throw lastErr;
}

function main() {
  const report = JSON.parse(fs.readFileSync(HASH_REPORT, 'utf8'));
  const rows = report.results.filter(
    (r) =>
      r.verdict === 'verified_duplicate' &&
      r.recommendedAction === 'move_to_quarantine_after_approval',
  );

  console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}: quarantine ${rows.length} verified duplicate folders\n`);

  const stats = { moved: 0, alreadyMoved: 0, failed: 0 };
  /** @type {{ folder: string, sourceRemote: string, destRemote: string, status: string, error?: string }[]} */
  const log = [];

  for (const row of rows) {
    const folder = row.reviewFolder;
    const sourceRemote = `drive:GEO_Master_Archive/_review/${REVIEW_PROVIDER}/${folder}`;
    const destRemote = `${QUARANTINE_BASE}/${folder}`;

    console.log(`→ ${folder}`);
    console.log(`  ${sourceRemote}`);
    console.log(`  -> ${destRemote}`);

    if (!EXECUTE) {
      log.push({ folder, sourceRemote, destRemote, status: 'dry_run' });
      continue;
    }

    try {
      const result = rcloneMove(sourceRemote, destRemote);
      if (result === 'already_moved') stats.alreadyMoved++;
      else stats.moved++;
      log.push({ folder, sourceRemote, destRemote, status: result });
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ folder, sourceRemote, destRemote, status: 'failed', error: msg });
      console.error(`  FAILED: ${msg}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: EXECUTE ? 'execute' : 'dry_run',
    quarantineBase: QUARANTINE_BASE,
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
