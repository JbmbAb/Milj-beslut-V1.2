import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.documentRecord.count({
      where: {
        OR: [
          { status: 'METADATA_ONLY' },
          { content: { is: null } }
        ]
      }
    });
    console.log('Documents needing OCR:', count);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
