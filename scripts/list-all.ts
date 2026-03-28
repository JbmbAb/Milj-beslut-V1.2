import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const schemas = await prisma.$queryRaw<any[]>`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema';`;
  console.log("Schemas:", schemas.map(s => s.nspname));
  
  const tables = await prisma.$queryRaw<any[]>`SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname != 'information_schema';`;
  console.log("Tables:");
  tables.forEach(t => console.log(` - ${t.schemaname}.${t.tablename}`));

  await prisma.$disconnect();
}
main();
