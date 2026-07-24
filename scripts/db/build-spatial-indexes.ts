import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function buildSpatialIndexes() {
  console.log('Starting post-import spatial indexing...');

  // Hämta alla partitioner för sgu_ground_layer
  const partitions = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'env' AND tablename LIKE 'sgu_ground_layer_g%'
  `);

  console.log(`Found ${partitions.length} partitions to index.`);

  for (const partition of partitions) {
    const tableName = `env.${partition.tablename}`;
    const indexName = `${partition.tablename}_geom_idx`;

    console.log(`Building index for ${tableName}...`);
    try {
      // Vi använder CONCURRENTLY om vi vill undvika att låsa tabellen helt,
      // men för en massimport är det snabbare utan det om ingen annan använder datan.
      // Här kör vi standard CREATE INDEX för maximal hastighet.
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS ${indexName} 
        ON ${tableName} USING GIST (geom);
      `);
      console.log(`[OK] Index ${indexName} created.`);
    } catch (error) {
      console.error(`[FAIL] Could not create index for ${tableName}:`, error);
    }
  }

  console.log('Indexing complete.');
}

buildSpatialIndexes()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
