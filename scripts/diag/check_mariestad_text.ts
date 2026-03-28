import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const list = await prisma.documentRecord.findMany({
      where: {
        AND: [
          { originalName: { endsWith: '.pdf', mode: 'insensitive' } },
          { content: { searchText: { contains: 'Mariestad', mode: 'insensitive' } } }
        ]
      },
      take: 1,
      include: { content: true }
    });
    if (list.length === 0) return;
    const doc = list[0];
    console.log(`Doc: ${doc.originalName}`);
    console.log(`Text: ${doc.content?.searchText?.slice(0, 5000)}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
