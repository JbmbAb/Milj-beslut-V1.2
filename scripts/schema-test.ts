import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Schema Creation Test ---');
  try {
    await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS stage_test;');
    console.log('✅ Schema stage_test created');
    await prisma.$executeRawUnsafe('CREATE TABLE stage_test.t (id int);');
    console.log('✅ Table stage_test.t created');
    const result = await prisma.$queryRawUnsafe("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'stage_test'");
    console.log('✅ Query result:', result);
    await prisma.$executeRawUnsafe('DROP SCHEMA stage_test CASCADE;');
    console.log('✅ Cleanup done');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
