import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const counts = await prisma.documentRecord.groupBy({
      by: ['status'],
      _count: true
    });
    console.log('Status counts:', counts);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
