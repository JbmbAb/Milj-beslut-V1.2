import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const docId = 'cmn1v1mk1003mcuuwnx33pagnu';
    const content = await prisma.documentContent.findUnique({ where: { documentId: docId } });
    console.log('Text length:', content?.searchText?.length);
    console.log('Sample text:', content?.searchText?.slice(0, 500));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
