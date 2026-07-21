/**
 * Importerar all nedladdad Lastkajen-data från storage/ingest/lastkajen till PostGIS.
 * Råfilerna behålls oförändrade.
 *
 * Run:
 *   npx dotenv -e .env -- tsx scripts/import/import-lastkajen-all-downloaded.ts
 *   npx dotenv -e .env -- tsx scripts/import/import-lastkajen-all-downloaded.ts --skip-package=10142,10169
 *   npx dotenv -e .env -- tsx scripts/import/import-lastkajen-all-downloaded.ts --only=tv_cykelvagnat,tv_vagbelaggning
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { getImportableLastkajenJobs } from '../../server/datasources/lastkajenImportManifest';
import {
  buildPgConn,
  jobsForDownloadedPackages,
  listDownloadedPackageIds,
  runLastkajenImportJob,
} from './lastkajenImportEngine';

dotenv.config();

const prisma = new PrismaClient();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ingestRoot = process.env.LASTKAJEN_INGEST_ROOT || path.join(repoRoot, 'storage/ingest/lastkajen');

const skipPackages = new Set(
  process.argv
    .filter((a) => a.startsWith('--skip-package='))
    .flatMap((a) => a.slice('--skip-package='.length).split(','))
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n)),
);

const onlyKeys = new Set(
  process.argv
    .filter((a) => a.startsWith('--only='))
    .flatMap((a) => a.slice('--only='.length).split(','))
    .map((s) => s.trim())
    .filter(Boolean),
);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const downloaded = listDownloadedPackageIds(ingestRoot);
  let jobs = jobsForDownloadedPackages(getImportableLastkajenJobs(), downloaded);
  if (skipPackages.size > 0) {
    jobs = jobs.filter((j) => !skipPackages.has(j.packageId));
  }
  if (onlyKeys.size > 0) {
    jobs = jobs.filter((j) => onlyKeys.has(j.key));
  }

  console.log(`\nLastkajen → PostGIS (allt nedladdat)`);
  console.log(`Paket på disk: ${downloaded.length} (${downloaded.join(', ')})`);
  console.log(`Importjobb: ${jobs.length}`);
  console.log(`Ingest: ${ingestRoot}\n`);

  await prisma.$executeRawUnsafe(`SET maintenance_work_mem = '2GB'`);
  await prisma.$executeRawUnsafe(`SET synchronous_commit = off`);

  const pgConn = buildPgConn(databaseUrl);
  const summary: Array<{ key: string; ok: boolean; error?: string; tables?: string[] }> = [];

  for (const job of jobs) {
    try {
      const result = await runLastkajenImportJob(prisma, pgConn, ingestRoot, job);
      summary.push({ key: job.key, ok: true, tables: result.tables.map((t) => t.table) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`   ✗ ${job.key}: ${message}`);
      summary.push({ key: job.key, ok: false, error: message });
    }
  }

  const okCount = summary.filter((s) => s.ok).length;
  const failCount = summary.length - okCount;

  console.log(`\n${'='.repeat(52)}`);
  console.log(`Klart: ${okCount} jobb OK, ${failCount} misslyckade`);
  if (failCount > 0) {
    console.log('Misslyckade:');
    for (const s of summary.filter((x) => !x.ok)) {
      console.log(`  - ${s.key}: ${s.error}`);
    }
    process.exitCode = 1;
  }
  console.log('Nedladdade filer oförändrade i storage/ingest/lastkajen/\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
