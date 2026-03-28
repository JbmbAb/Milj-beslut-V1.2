import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Deep Table Audit ---');
  try {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema IN ('stage', 'env', 'core', 'public')
    `);
    console.log('✅ Found nodes:', JSON.stringify(tables, null, 2));

    const schemas = await prisma.$queryRawUnsafe('SELECT nspname FROM pg_namespace');
    console.log('✅ Namespaces:', JSON.stringify(schemas, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
