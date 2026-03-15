import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Spatial Index Check (Refined) ---');
  try {
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT
          n.nspname as schema_name,
          t.relname as table_name,
          i.relname as index_name,
          am.amname as index_type
      FROM
          pg_class t
          JOIN pg_index ix ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_am am ON i.relam = am.oid
          JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE
          t.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND am.amname = 'gist'
      ORDER BY
          schema_name, table_name;
    `);
    console.log('✅ GIST Indexes:', JSON.stringify(indexes, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
