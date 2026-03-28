import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const chunk = await prisma.documentChunk.findFirst({
    select: { id: true, documentId: true, chunkText: true, chunkIndex: true }
  });
  console.log('--- Sample Chunk ---');
  console.log(JSON.stringify(chunk, null, 2));

  // Check max chunk index per document for the first 5 documents
  const maxIndices = await prisma.$queryRaw`
    SELECT "documentId", MAX("chunkIndex") as max_idx
    FROM "DocumentChunk"
    GROUP BY "documentId"
    LIMIT 10
  `;
  console.log('\n--- Max Chunk Indices per Document (Top 10) ---');
  console.log(JSON.stringify(maxIndices, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

}

main().catch(console.error).finally(() => prisma.$disconnect());
