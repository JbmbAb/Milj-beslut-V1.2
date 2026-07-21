import { PrismaClient } from '@prisma/client';
import { getSguBulkImportJobs } from '../../server/datasources/sguBulkImportManifest';

const prisma = new PrismaClient();

const KEY_TABLES = [
  'env.sgu_well_actual',
  'env.sgu_well_lager',
  'env.sgu_soil_type_25k_100k',
  'env.sgu_fastmark_stabilitet',
  'env.sgu_permeability',
  'env.sgu_blockighet',
  'env.sgu_ground_layer_1m',
  'env.sgu_landslide_feature',
  'env.sgu_groundwater_magazine',
  'env.sgu_groundwater_body',
];

async function main() {
  const jobs = getSguBulkImportJobs();
  let tablesWithData = 0;
  let totalRows = 0n;
  const top: Array<{ table: string; rows: bigint }> = [];

  for (const job of jobs) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM ${job.table}`,
      );
      const n = rows[0]?.n ?? 0n;
      if (n > 0n) {
        tablesWithData += 1;
        totalRows += n;
        top.push({ table: job.table, rows: n });
      }
    } catch {
      // table missing
    }
  }

  top.sort((a, b) => (a.rows > b.rows ? -1 : 1));

  const keyStats: Record<string, string> = {};
  for (const table of KEY_TABLES) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM ${table}`,
      );
      keyStats[table] = (rows[0]?.n ?? 0n).toLocaleString('sv-SE');
    } catch {
      keyStats[table] = 'saknas';
    }
  }

  console.log(
    JSON.stringify(
      {
        manifestJobs: jobs.length,
        tablesWithData,
        percentTables: Math.round((tablesWithData / jobs.length) * 100),
        totalRows: totalRows.toLocaleString('sv-SE'),
        keyTables: keyStats,
        top10ByRows: top.slice(0, 10).map((t) => ({
          table: t.table,
          rows: t.rows.toLocaleString('sv-SE'),
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
