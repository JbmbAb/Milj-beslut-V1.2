import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const res: any = await prisma.$queryRawUnsafe(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  `);
  console.log("All tables in DB:");
  for (const row of res) {
    console.log(` - ${row.table_schema}.${row.table_name}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
