import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`SELECT count(*) FROM core.property_unit WHERE designation ILIKE '%STACKMORA 3:12%';`;
  console.log(JSON.stringify(result, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  await prisma.$disconnect();
}
main();
