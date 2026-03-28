import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const metsa = await prisma.documentContent.count({
      where: { searchText: { contains: 'Metsä', mode: 'insensitive' } }
    });
    const vanern = await prisma.documentContent.count({
      where: { searchText: { contains: 'Vänern', mode: 'insensitive' } }
    });
    console.log({ metsa, vanern });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
