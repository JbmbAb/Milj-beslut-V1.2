import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Direct Attribute Check ---');
  try {
    const attrs = await prisma.$queryRawUnsafe(`
      SELECT a.attname, t.typname
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE n.nspname = 'env' AND c.relname = 'sgu_ground_layer' AND a.attnum > 0;
    `);
    console.log('✅ Attributes in sgu_ground_layer:', JSON.stringify(attrs, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
