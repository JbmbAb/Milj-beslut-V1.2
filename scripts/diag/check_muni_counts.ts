import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const counts = await prisma.documentRecord.groupBy({
      by: ['municipality'],
      _count: true,
      orderBy: { _count: { id: 'desc' } }
    });
    console.log('Municipality Counts:', counts);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
