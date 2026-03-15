import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Regclass Test ---');
  try {
    const tableName = 'stage.sgu_ground_layer_raw';
    const result = await prisma.$queryRawUnsafe(`SELECT to_regclass('${tableName}')::text AS regclass`);
    console.log('✅ Result for', tableName, ':', result);
    
    const tables = await prisma.$queryRawUnsafe("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'sgu_ground_layer_raw'");
    console.log('✅ Info Schema:', tables);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
