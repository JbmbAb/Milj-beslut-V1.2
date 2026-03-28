import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const list = await prisma.documentContent.findMany({
      where: {
        searchText: { contains: 'Mariestad', mode: 'insensitive' }
      },
      select: { documentId: true }
    });
    console.log('Docs mentioning Mariestad:', list.length);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
