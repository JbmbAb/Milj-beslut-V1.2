import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const db = await prisma.$queryRawUnsafe("SELECT current_database();");
    console.log('Current DB:', db);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
