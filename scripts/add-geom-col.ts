import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Manual Geometry Column Addition ---');
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE env.sgu_ground_layer ADD COLUMN geom geometry(MultiPolygon, 3006);');
    console.log('✅ Column added successfully.');
  } catch (error: any) {
    console.error('❌ Error adding column:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
