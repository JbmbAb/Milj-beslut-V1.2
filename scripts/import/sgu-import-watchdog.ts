/**
 * Övervakar SGU bulk-import: startar om vid avbrott tills alla jobb är klara.
 *
 * Start:
 *   npx dotenv -e .env -- tsx scripts/import/sgu-import-watchdog.ts
 *
 * Loggar: storage/ingest/sgu/watchdog.log, import-run.log
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { getSguBulkImportJobs } from '../../server/datasources/sguBulkImportManifest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ingestDir = path.join(repoRoot, 'storage/ingest/sgu');
const WATCHDOG_LOCK = path.join(ingestDir, 'watchdog.lock');
const WATCHDOG_LOG = path.join(ingestDir, 'watchdog.log');
const IMPORT_LOG = path.join(ingestDir, 'import-run.log');
const RETRY_DELAY_MS = 20_000;
const HEARTBEAT_MS = 5 * 60_000;

function log(msg: string): void {
  fs.mkdirSync(ingestDir, { recursive: true });
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(WATCHDOG_LOG, line);
  console.log(msg);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireWatchdogLock(): void {
  if (fs.existsSync(WATCHDOG_LOCK)) {
    const existing = Number.parseInt(fs.readFileSync(WATCHDOG_LOCK, 'utf8').trim(), 10);
    if (existing && isProcessRunning(existing)) {
      throw new Error(`Watchdog körs redan (PID ${existing})`);
    }
  }
  fs.writeFileSync(WATCHDOG_LOCK, String(process.pid));
}

function releaseWatchdogLock(): void {
  try {
    if (fs.existsSync(WATCHDOG_LOCK)) {
      const owner = Number.parseInt(fs.readFileSync(WATCHDOG_LOCK, 'utf8').trim(), 10);
      if (!owner || owner === process.pid) fs.unlinkSync(WATCHDOG_LOCK);
    }
  } catch {
    // ignore
  }
}

async function countLoadedTables(): Promise<{ loaded: number; total: number }> {
  const prisma = new PrismaClient();
  const jobs = getSguBulkImportJobs();
  let loaded = 0;
  try {
    for (const job of jobs) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM ${job.table}`,
        );
        if ((rows[0]?.n ?? 0n) > 0n) loaded += 1;
      } catch {
        // missing
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  return { loaded, total: jobs.length };
}

function runImportOnce(): Promise<number> {
  return new Promise((resolve) => {
    log('Startar import-sgu-bulk.ts --resume');
    fs.mkdirSync(ingestDir, { recursive: true });
    const logStream = fs.createWriteStream(IMPORT_LOG, { flags: 'a' });
    logStream.write(`\n===== RUN ${new Date().toISOString()} =====\n`);

    const cmd =
      'npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts --resume';
    const child = spawn(cmd, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: process.env,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      logStream.write(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text);
      logStream.write(text);
    });

    child.on('close', (code, signal) => {
      logStream.end();
      if (signal) {
        log(`Import avbruten (signal ${signal})`);
        resolve(1);
        return;
      }
      log(`Import avslutad med exit code ${code ?? 'unknown'}`);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      logStream.end();
      log(`Import spawn-fel: ${err.message}`);
      resolve(1);
    });
  });
}

function importLogShowsComplete(): boolean {
  if (!fs.existsSync(IMPORT_LOG)) return false;
  const tail = fs.readFileSync(IMPORT_LOG, 'utf8').slice(-4000);
  return tail.includes('SGU IMPORT KLAR');
}

async function main(): Promise<void> {
  acquireWatchdogLock();
  log(`Watchdog startad (PID ${process.pid})`);

  const heartbeat = setInterval(async () => {
    const { loaded, total } = await countLoadedTables();
    log(`Heartbeat: ${loaded}/${total} tabeller (${Math.round((loaded / total) * 100)}%)`);
  }, HEARTBEAT_MS);

  try {
    while (true) {
      const before = await countLoadedTables();
      log(`Status före körning: ${before.loaded}/${before.total} tabeller`);

      if (before.loaded >= before.total && importLogShowsComplete()) {
        log('Alla tabeller inlästa och import loggar KLAR – watchdog avslutar.');
        break;
      }

      const code = await runImportOnce();
      const after = await countLoadedTables();
      log(`Status efter körning: ${after.loaded}/${after.total} tabeller (exit ${code})`);

      if (after.loaded >= after.total && importLogShowsComplete()) {
        log('Import färdig.');
        break;
      }

      if (after.loaded === before.loaded && code !== 0) {
        log(
          'Ingen ny progress och fel exit – troligen avbruten extern process (t.ex. IDE-shell timeout). Startar om…',
        );
      }

      log(`Väntar ${RETRY_DELAY_MS / 1000}s innan nästa försök…`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  } finally {
    clearInterval(heartbeat);
    releaseWatchdogLock();
  }
}

main().catch((err) => {
  log(`Watchdog krasch: ${err instanceof Error ? err.message : String(err)}`);
  releaseWatchdogLock();
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  log('Watchdog SIGINT – avslutar.');
  releaseWatchdogLock();
  process.exit(0);
});
