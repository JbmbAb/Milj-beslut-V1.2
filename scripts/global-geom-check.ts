import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Global Geometry Column Check ---');
  try {
    const cols = await prisma.$queryRawUnsafe(`
      SELECT n.nspname as schema, c.relname as table, a.attname as column, t.typname as type
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE t.typname = 'geometry' AND a.attnum > 0;
    `);
    console.log('✅ Geometry columns found:', JSON.stringify(cols, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
