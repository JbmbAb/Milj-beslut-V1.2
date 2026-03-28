import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.searchJob.groupBy({
    by: ['type', 'status'],
    _count: true
  });
  console.log(JSON.stringify(counts, null, 2));
  await prisma.$disconnect();
}

main();
