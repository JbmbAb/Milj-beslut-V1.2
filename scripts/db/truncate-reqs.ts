import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "RequirementRecord" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "RequirementCase" CASCADE');
  console.log('Truncated requirement tables.');
}
main().finally(() => prisma.$disconnect());
