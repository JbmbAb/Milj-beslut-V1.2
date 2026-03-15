import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- env.sgu_ground_layer Column Check ---');
  try {
    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_schema = 'env' AND table_name = 'sgu_ground_layer'
    `);
    console.log('✅ Columns:', JSON.stringify(cols, null, 2));

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
