import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const doc = await prisma.documentRecord.findUnique({
      where: { id: 'cmn1v1mk1003mcuuwnx33pagnu' },
      include: { content: true }
    });
    console.log('Doc Status:', doc?.status);
    console.log('Content exists:', !!doc?.content);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
