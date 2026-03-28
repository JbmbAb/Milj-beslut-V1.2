import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const schemas = await prisma.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata;");
    console.log('Schemas:', schemas);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
