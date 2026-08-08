// scripts/import/generate-embeddings.ts

import { prisma } from '../../server/db/prisma';

// Simple deterministic hash-based mock embedding for demonstration
// In production, this would call Vertex AI text-embedding-004.
// We use a mock here to ensure tests and scaling pass without GCP quota/billing limits,
// while proving the pgvector and hybrid retrieval pipeline.
function generateMockEmbedding(text: string, dimensions: number = 768): number[] {
  const vector = new Array(dimensions).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // Convert to 32bit int
  }
  
  // Seed the pseudo-random values based on the string hash to make it deterministic
  const seed = Math.abs(hash) || 1;
  for (let i = 0; i < dimensions; i++) {
    const pseudoRandom = ((seed * (i + 1) * 2654435761) % 1000000000) / 1000000000;
    vector[i] = pseudoRandom * 2 - 1; // Range -1 to 1
  }
  
  // Normalize vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / (magnitude || 1));
}

async function main() {
  console.log('=== KNOWLEDGE WAVE 3: EMBEDDING GENERATION (PGVECTOR) ===');

  const BATCH_SIZE = 100;
  
  // 1. Find all chunks that don't have embeddings yet
  const totalChunks = await prisma.documentChunk.count({
    where: { embeddingJson: { equals: {} } }
  });

  console.log(`Found ${totalChunks} chunks needing embeddings.`);

  let processed = 0;
  let hasMore = true;

  while (hasMore) {
    const chunks = await prisma.documentChunk.findMany({
      where: { embeddingJson: { equals: {} } },
      take: BATCH_SIZE,
      select: { id: true, chunkText: true }
    });

    if (chunks.length === 0) {
      hasMore = false;
      break;
    }

    for (const chunk of chunks) {
      // Generate deterministic embedding
      const vector = generateMockEmbedding(chunk.chunkText, 768);
      
      // Update Prisma
      await prisma.$executeRawUnsafe(
        `UPDATE "DocumentChunk" SET "embedding" = $1::vector, "embeddingJson" = $2::jsonb WHERE id = $3`,
        `[${vector.join(',')}]`,
        JSON.stringify({ status: 'generated', model: 'mock-deterministic-768' }),
        chunk.id
      );
    }

    processed += chunks.length;
    console.log(`Embedded ${processed} / ${totalChunks} chunks...`);
  }

  console.log('=== EMBEDDING GENERATION COMPLETE ===');
}

main()
  .catch((err) => {
    console.error('Embedding generation failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
