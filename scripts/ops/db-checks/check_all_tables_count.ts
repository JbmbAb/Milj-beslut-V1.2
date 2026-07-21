import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tablesQuery = `
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  `;

  const tables = await prisma.$queryRawUnsafe<{ schemaname: string; tablename: string }[]>(tablesQuery);
  const results: { table: string; count: number }[] = [];

  console.log(`Checking ${tables.length} tables...`);

  for (const t of tables) {
    const fullName = `"${t.schemaname}"."${t.tablename}"`;
    try {
      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) as count FROM ${fullName}`,
      );
      const count = Number(countRes[0].count);
      if (count > 0) {
        results.push({ table: fullName, count });
      }
    } catch {
      // Skip tables that fail (e.g. permission issues or views that look like tables)
    }
  }

  results.sort((a, b) => b.count - a.count);
  console.log('--- Tables with records (Actual COUNT) ---');
  console.table(results);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
