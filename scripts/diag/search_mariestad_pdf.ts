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
      select: { id: true, originalName: true }
    });
    console.log('PDFs with Mariestad:', list.length);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
