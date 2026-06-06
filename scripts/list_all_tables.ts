import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const tables = await prisma.$queryRawUnsafe<any[]>(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_schema, table_name"
    );
    console.table(tables);
  } catch (err: any) {
    console.error('Error querying database:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
