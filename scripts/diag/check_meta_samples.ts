import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const samples = await prisma.documentRecord.findMany({
      take: 20,
      select: { legalStatus: true, municipality: true, decisionType: true }
    });
    console.log(JSON.stringify(samples, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
