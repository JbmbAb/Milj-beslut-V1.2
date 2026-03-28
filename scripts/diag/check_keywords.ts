import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const doc = await prisma.documentRecord.findFirst({
      where: { originalName: { contains: 'M-2024-487-1' } },
      include: { content: true }
    });
    if (!doc?.content?.searchText) return;
    const skaHits = (doc.content.searchText.match(/ska/gi) || []).length;
    console.log(`Hits for 'ska': ${skaHits}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
