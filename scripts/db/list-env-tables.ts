import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tables = await prisma.$queryRaw<any[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'env'`;
  console.log('Tables in env:', tables.map(t => t.table_name));
}
main().finally(() => prisma.$disconnect());
