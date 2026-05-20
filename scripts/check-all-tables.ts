import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Schema & Table List ---');
  try {
    const allTables = await prisma.$queryRaw<Array<{ schemaname: string, tablename: string }>>`
      SELECT schemaname, tablename FROM pg_tables 
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename
    `;

    for (const table of allTables) {
      const count = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*) as count FROM "${table.schemaname}"."${table.tablename}"`
      );
      console.log(`${table.schemaname}.${table.tablename}: ${(count as any)[0].count} rows`);
    }
  } catch (err: any) {
    console.log(`Error: ${err.message.split('\n')[0]}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
