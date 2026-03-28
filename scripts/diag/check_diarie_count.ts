import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.documentRecord.count({ where: { legalStatus: { not: null } } });
    console.log('Documents WITH legalStatus:', count);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
