import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const list = await prisma.documentRecord.findMany({
      where: { originalName: 'MBN-2025-2433_ Datum 2025.pdf' },
      include: { content: true }
    });
    const doc = list[0];
    const text = doc.content?.searchText || '';
    const hits = (text.match(/ska/gi) || []).length;
    console.log(`Text length: ${text.length}, 'ska' hits: ${hits}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
