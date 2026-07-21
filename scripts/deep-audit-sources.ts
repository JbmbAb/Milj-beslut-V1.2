import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const samples = await prisma.documentRecord.findMany({
    select: { municipality: true, municipalityNormalized: true, absolutePath: true },
    take: 20
  });
  console.log('--- Document Samples ---');
  console.log(JSON.stringify(samples, null, 2));

  const dist = await prisma.documentRecord.groupBy({
    by: ['municipalityNormalized'],
    _count: { id: true }
  });
  console.log('--- Municipality Distribution ---');
  console.log(JSON.stringify(dist, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
