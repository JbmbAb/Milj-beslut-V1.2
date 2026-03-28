import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const doc = await prisma.documentRecord.findFirst({
      where: { status: 'TEXT_EXTRACTED' },
      include: { content: true }
    });
    if (!doc) return;
    console.log(`Testing extraction for ${doc.id} / ${doc.originalName}`);
    console.log(`Content length: ${doc.content?.searchText?.length}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
