import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.documentContent.count();
  console.log(`DocumentContent count: ${count}`);
  await prisma.$disconnect();
}

main();
