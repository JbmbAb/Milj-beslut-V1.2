import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Schema Check ---');
  try {
    const schemas = await prisma.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata');
    console.log('✅ Schemas:', JSON.stringify(schemas, null, 2));

    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema IN ('stage', 'env', 'core', 'public')
      ORDER BY table_schema, table_name
    `);
    console.log('✅ Tables:', JSON.stringify(tables, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
