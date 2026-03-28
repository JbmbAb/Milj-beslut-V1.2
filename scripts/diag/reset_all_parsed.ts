import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const res = await prisma.$executeRawUnsafe("UPDATE attachments SET parsed = false;");
    console.log(`Reset ${res} attachments to parsed = false.`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
