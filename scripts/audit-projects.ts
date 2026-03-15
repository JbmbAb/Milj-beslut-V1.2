import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.documentRecord.groupBy({
    by: ['projectId'],
    _count: { _all: true }
  });
  
  console.log('Document counts per project:', JSON.stringify(counts, null, 2));
  
  const p = await prisma.project.findMany({ select: { id: true, propertyDesignation: true } });
  console.log('Available projects:', JSON.stringify(p, null, 2));

  await prisma.$disconnect();
}

main();
