import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Column Check ---');
  try {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name, column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_schema = 'env' AND table_name = 'sgu_ground_layer'
    `);
    console.log('✅ Columns in sgu_ground_layer:', JSON.stringify(columns, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
