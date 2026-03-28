import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const dbs = await prisma.$queryRawUnsafe("SELECT datname FROM pg_database;");
    console.log('Dbs:', dbs);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
