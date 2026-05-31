import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRaw`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('public', 'env', 'topo10', 'core') 
    ORDER BY table_schema, table_name
  `;
  console.log(JSON.stringify(tables, null, 2));

  console.log('\n--- Row Counts ---');
  for (const table of tables as any[]) {
    try {
      const countRes = await prisma.$queryRawUnsafe(
        `SELECT count(*) as count FROM "${table.table_schema}"."${table.table_name}"`,
      );
      console.log(`${table.table_schema}.${table.table_name}: ${(countRes as any)[0].count}`);
    } catch {
      console.log(`${table.table_schema}.${table.table_name}: error reading count`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
