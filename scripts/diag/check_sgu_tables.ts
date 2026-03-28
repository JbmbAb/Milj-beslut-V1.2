import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const allTables = await prisma.$queryRawUnsafe("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name LIKE '%sgu%';");
    console.log('All SGU tables:', allTables);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
