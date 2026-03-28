import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const doc = await prisma.documentRecord.findFirst({
      where: { id: { contains: 'cmn1v' } }
    });
    if (!doc) return;
    const reqs = await prisma.requirementRecord.findMany({
      where: { documentId: doc.id }
    });
    console.log(`Reqs for [${doc.id}] ${doc.originalName}:`, reqs.length);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
