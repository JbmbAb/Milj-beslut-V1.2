import { PrismaClient } from '@prisma/client';
import { getSguBulkImportJobs } from '../../server/datasources/sguBulkImportManifest';
import { tableHasRows } from './sguBulkImportEngine';

const prisma = new PrismaClient();

async function main() {
  const jobs = getSguBulkImportJobs();
  const missing: string[] = [];
  const empty: string[] = [];

  for (const job of jobs) {
    const has = await tableHasRows(prisma, job.table);
    if (has) continue;
    try {
      await prisma.$queryRawUnsafe(`SELECT 1 FROM ${job.table} LIMIT 0`);
      empty.push(`${job.key} → ${job.table}`);
    } catch {
      missing.push(`${job.key} → ${job.table} (${job.zipFile}/${job.layer})`);
    }
  }

  console.log(`Pending: ${empty.length + missing.length} (empty: ${empty.length}, no table: ${missing.length})`);
  for (const line of [...empty, ...missing]) console.log(line);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
