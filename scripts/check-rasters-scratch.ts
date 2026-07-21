import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe<any[]>(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'staging'
      ORDER BY table_name
    `);
    console.log('Tables in staging schema:', JSON.stringify(tables, null, 2));

    const schemas = await prisma.$queryRawUnsafe<any[]>(`
      SELECT schema_name 
      FROM information_schema.schemata 
      ORDER BY schema_name
    `);
    console.log('Available schemas:', JSON.stringify(schemas, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
