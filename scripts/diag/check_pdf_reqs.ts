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
      select: { id: true }
    });
    const ids = list.map(d => d.id);
    const count = await prisma.requirementRecord.count({ where: { documentId: { in: ids } } });
    console.log('Requirements in Mariestad PDFs:', count);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
