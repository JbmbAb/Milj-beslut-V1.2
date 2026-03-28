import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const counts = await prisma.documentRecord.groupBy({
      by: ['projectId'],
      _count: true
    });
    console.log('Project IDs in DB:', counts);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
