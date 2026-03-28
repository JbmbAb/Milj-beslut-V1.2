import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const reqs = await prisma.requirementRecord.findMany({
      where: { documentId: 'cmn1vbop30001' }
    });
    console.log('Requirements for cmn1vbop30001:', reqs.length);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
