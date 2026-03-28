import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const seqs = await prisma.$queryRawUnsafe("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'env';");
    console.log('Seqs in env:', seqs);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
