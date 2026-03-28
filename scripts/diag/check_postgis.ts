import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$queryRawUnsafe('SELECT PostGIS_Version();');
    console.log('PostGIS Version:', result);
    
    const schemas = await prisma.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'env';");
    console.log('Env schema exists:', schemas);
  } catch (e) {
    console.error('PostGIS not found or error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
