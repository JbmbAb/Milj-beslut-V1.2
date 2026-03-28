import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const list = await prisma.documentContent.findMany({
      where: { searchText: { contains: 'Mariestad', mode: 'insensitive' } },
      take: 3,
      select: { documentId: true, searchText: true }
    });
    for (const d of list) {
       console.log(`Doc ${d.documentId} snippet:`, d.searchText.slice(0, 500));
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
