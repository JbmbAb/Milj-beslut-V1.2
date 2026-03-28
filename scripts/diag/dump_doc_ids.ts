import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const list = await prisma.documentRecord.findMany({
      take: 10,
      select: { id: true, originalName: true }
    });
    console.log(JSON.stringify(list, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
