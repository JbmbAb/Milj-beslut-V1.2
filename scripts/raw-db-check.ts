import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Raw SQL Check ---');
  try {
    const result = await prisma.$queryRawUnsafe('SELECT 1 as connected');
    console.log('✅ Connectivity check:', result);

    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name
    `);
    console.log('✅ Tables found:', tables);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
