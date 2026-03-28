import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const unparsed = await prisma.$queryRawUnsafe("SELECT count(*) FROM attachments WHERE parsed = FALSE AND document_id IS NOT NULL;");
    const totalAttached = await prisma.$queryRawUnsafe("SELECT count(*) FROM attachments;");
    console.log({ unparsed, totalAttached });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
