
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = [
    'env.sgu_soil_type',
    'env.sgu_soil_depth',
    'env.sgu_permeability',
    'env.sgu_bedrock',
    'env.sgu_well',
    'env.sgu_groundwater_magazine'
  ];
  try {
    for (const table of tables) {
      const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) FROM ${table}`);
      console.log(`${table}:`, result);
    }
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
