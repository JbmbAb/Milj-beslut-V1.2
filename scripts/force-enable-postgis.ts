import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Force Enabling PostGIS ---');
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION postgis;');
    console.log('✅ PostGIS enabled successfully.');
  } catch (error: any) {
    console.error('❌ Error enabling PostGIS:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
