import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const health = await prisma.$queryRawUnsafe("SELECT * FROM external_health_checks WHERE category = 'SGU' ORDER BY checked_at DESC LIMIT 5;");
    console.log(JSON.stringify(health, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
