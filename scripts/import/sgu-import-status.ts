import { PrismaClient } from '@prisma/client';
import { getSguBulkImportJobs } from '../../server/datasources/sguBulkImportManifest';

const prisma = new PrismaClient();

async function main() {
  const jobs = getSguBulkImportJobs();
  let withData = 0;
  let empty = 0;
  let missing = 0;

  for (const job of jobs) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM ${job.table}`,
      );
      if ((rows[0]?.n ?? 0n) > 0n) withData += 1;
      else empty += 1;
    } catch {
      missing += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        totalJobs: jobs.length,
        tablesWithData: withData,
        emptyTables: empty,
        missingTables: missing,
        percentComplete: Math.round((withData / jobs.length) * 100),
      },
      null,
      2,
    ),
  );

  const pg = await prisma.$queryRawUnsafe<
    { name: string; setting: string; unit: string | null }[]
  >(
    `SELECT name, setting, unit FROM pg_settings
     WHERE name IN (
       'maintenance_work_mem','work_mem','shared_buffers','effective_cache_size',
       'synchronous_commit','autovacuum','max_wal_size','max_parallel_maintenance_workers'
     )
     ORDER BY name`,
  );
  console.log('\nPostgreSQL:');
  console.log(JSON.stringify(pg, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
