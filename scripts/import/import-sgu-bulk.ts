/**
 * SGU bulk import: ZIP/GPKG från Downloads → PostGIS med session- och indexoptimering.
 *
 * Run:
 *   npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts
 *   npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts --dry-run
 *   npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts --only=brunnar,jord25k_grundlager
 *   npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts --resume
 *   SGU_DOWNLOAD_DIR=D:\data\sgu npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts
 *
 * Fas 1: ogr2ogr (UNLOGGED, COPY, inga spatial index under load)
 * Fas 2: GIST-index per tabell (maintenance_work_mem=4GB)
 * Fas 3: VACUUM ANALYZE
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getSguBulkImportJobs,
  type SguBulkImportJob,
} from '../../server/datasources/sguBulkImportManifest';
import {
  applyBulkSessionSettings,
  buildPgConn,
  buildSpatialIndex,
  defaultSguDownloadDir,
  dropInterruptedSguTables,
  dropSuspectPartialTables,
  formatElapsed,
  importSguJob,
  resetBulkSessionSettings,
  resolveSguSourcePath,
  tableHasRows,
  vacuumAnalyzeTable,
} from './sguBulkImportEngine';

dotenv.config();

const prisma = new PrismaClient();

const LOCK_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../storage/ingest/sgu/bulk-import.lock',
);

const PROGRESS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../storage/ingest/sgu/import-progress.json',
);

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireImportLock(): void {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  if (fs.existsSync(LOCK_PATH)) {
    const existingPid = Number.parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (existingPid && isProcessRunning(existingPid)) {
      throw new Error(
        `SGU-import körs redan (PID ${existingPid}). Avsluta den processen innan ny start.`,
      );
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}

function releaseImportLock(): void {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const owner = Number.parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
      if (!owner || owner === process.pid) {
        fs.unlinkSync(LOCK_PATH);
      }
    }
  } catch {
    // ignore
  }
}

function parseOnlyKeys(argv: string[]): Set<string> | null {
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  if (!onlyArg) return null;
  return new Set(
    onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function filterJobs(jobs: SguBulkImportJob[], only: Set<string> | null): SguBulkImportJob[] {
  if (!only || only.size === 0) return jobs;
  const needles = [...only];
  return jobs.filter((j) => {
    if (only.has(j.key)) return true;
    const zip = j.zipFile.toLowerCase();
    const key = j.key.toLowerCase();
    return needles.some(
      (n) =>
        key.startsWith(n.toLowerCase()) ||
        zip.includes(n.toLowerCase()) ||
        j.table.toLowerCase().includes(n.toLowerCase()),
    );
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipIndex = process.argv.includes('--skip-index');
  const resume = process.argv.includes('--resume');
  const downloadDir = defaultSguDownloadDir();
  const only = parseOnlyKeys(process.argv);
  const jobs = filterJobs(getSguBulkImportJobs(), only);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  console.log('\nSGU bulk import → PostGIS');
  console.log(`Källa: ${downloadDir}`);
  console.log(`Jobb: ${jobs.length}${only ? ` (filter: ${[...only].join(', ')})` : ''}`);
  console.log(`Dry-run: ${dryRun}`);
  console.log(`Resume: ${resume}`);
  console.log(`Index-fas: ${skipIndex ? 'SKIP' : 'ON'}`);
  console.log('');

  if (dryRun) {
    for (const job of jobs) {
      console.log(
        `[${job.priority}] ${job.key} → ${job.table} (${job.layer} @ ${job.zipFile})`,
      );
      console.log(`    ${resolveSguSourcePath(downloadDir, job)}`);
    }
    return;
  }

  acquireImportLock();

  const pgConn = buildPgConn(databaseUrl);
  const importStart = Date.now();
  const completed: SguBulkImportJob[] = [];
  const failed: Array<{ job: SguBulkImportJob; error: string }> = [];
  let skipped = 0;

  await applyBulkSessionSettings(prisma);

  if (resume) {
    const partial = await dropSuspectPartialTables(prisma);
    if (partial.length > 0) {
      console.log(`Rensade ofullständiga tabeller: ${partial.join(', ')}`);
    }
    const dropped = await dropInterruptedSguTables(prisma);
    if (dropped.length > 0) {
      console.log(`Rensade avbrutna tabeller: ${dropped.join(', ')}`);
    }
  }

  for (const job of jobs) {
    const t0 = Date.now();
    console.log(`\n→ [${job.priority}] ${job.key}`);
    console.log(`   ${job.label}`);
    console.log(`   ${job.table} ← ${job.layer}`);

    if (resume && (await tableHasRows(prisma, job.table))) {
      console.log(`   ↷ hoppar över (data finns redan)`);
      completed.push(job);
      skipped += 1;
      continue;
    }

    try {
      const rows = await importSguJob(prisma, pgConn, downloadDir, job);
      console.log(`   ✓ ${rows.toLocaleString('sv-SE')} rader (${formatElapsed(t0)})`);
      completed.push(job);
      fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
      fs.writeFileSync(
        PROGRESS_PATH,
        JSON.stringify(
          {
            lastJob: job.key,
            table: job.table,
            rows: rows.toString(),
            at: new Date().toISOString(),
            completed: completed.length,
            total: jobs.length,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ✗ ${msg}`);
      failed.push({ job, error: msg });
    }
  }

  if (!skipIndex && completed.length > 0) {
    console.log(`\n── Fas 2: spatial index (${completed.length} tabeller) ──`);
    const idxStart = Date.now();
    for (const job of completed) {
      try {
        console.log(`   INDEX ${job.table}...`);
        await buildSpatialIndex(prisma, job.table);
      } catch (err) {
        console.warn(
          `   ⚠ index ${job.table}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    console.log(`   Index klar (${formatElapsed(idxStart)})`);

    console.log(`\n── Fas 3: VACUUM ANALYZE ──`);
    const vacStart = Date.now();
    for (const job of completed) {
      try {
        await vacuumAnalyzeTable(prisma, job.table);
        console.log(`   ✓ ${job.table}`);
      } catch (err) {
        console.warn(
          `   ⚠ vacuum ${job.table}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    console.log(`   VACUUM klar (${formatElapsed(vacStart)})`);
  }

  await resetBulkSessionSettings(prisma);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`SGU IMPORT KLAR (total ${formatElapsed(importStart)})`);
  console.log(`   OK: ${completed.length}${skipped ? ` (varav ${skipped} resume-skip)` : ''}`);
  console.log(`   Fel: ${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) {
      console.log(`   - ${f.job.key}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    releaseImportLock();
    return prisma.$disconnect();
  });
