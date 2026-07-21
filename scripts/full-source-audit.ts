import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const dist = await prisma.documentRecord.groupBy({
    by: ['municipality'],
    _count: { id: true }
  });
  console.log('--- Document Distribution by Municipality ---');
  console.log(JSON.stringify(dist, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
