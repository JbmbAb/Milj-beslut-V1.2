import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const schemas = await prisma.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata;");
    console.log(JSON.stringify(schemas, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
