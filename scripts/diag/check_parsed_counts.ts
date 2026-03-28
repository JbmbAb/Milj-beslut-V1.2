import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const counts = await prisma.$queryRawUnsafe("SELECT parsed, count(*) FROM attachments GROUP BY parsed;");
    console.log('Attachment parsed counts:', counts);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
