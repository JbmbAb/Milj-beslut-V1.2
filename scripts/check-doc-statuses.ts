import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const statuses = await prisma.documentRecord.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  console.log('--- Document Statuses ---');
  console.log(JSON.stringify(statuses, null, 2));

  const chunkCount = await prisma.documentChunk.count();
  console.log('\n--- Chunk Count ---');
  console.log(chunkCount);

  // Check if chunks are linked to documents
  const chunksWithDocs = await prisma.documentChunk.count({
    where: { documentId: { not: '' } }
  });
  console.log('\n--- Chunks with documentId ---');
  console.log(chunksWithDocs);

}

main().catch(console.error).finally(() => prisma.$disconnect());
