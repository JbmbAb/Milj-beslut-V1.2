import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { getImportableLastkajenJobs } from '../../server/datasources/lastkajenImportManifest';
import { jobsForDownloadedPackages, listDownloadedPackageIds } from './lastkajenImportEngine';

const prisma = new PrismaClient();
const ingestRoot = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  'storage/ingest/lastkajen',
);

async function tableHasRows(tableRef: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM ${tableRef}`,
    );
    return (rows[0]?.n ?? 0n) > 0n;
  } catch {
    return false;
  }
}

async function main() {
  const downloaded = listDownloadedPackageIds(ingestRoot);
  const jobs = jobsForDownloadedPackages(getImportableLastkajenJobs(), downloaded);
  const pending: string[] = [];
  const done: string[] = [];

  for (const job of jobs) {
    const has = await tableHasRows(job.table);
    if (has) done.push(job.key);
    else pending.push(`${job.key} → ${job.table}`);
  }

  console.log(`Done: ${done.length}, pending primary table: ${pending.length}`);
  for (const line of pending) console.log(line);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
