import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.$queryRaw`SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');`;
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}
main();
