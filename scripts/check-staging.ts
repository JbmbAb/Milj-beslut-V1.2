import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`SELECT count(*) FROM stage.property_unit_raw;`;
  const samples = await prisma.$queryRaw`SELECT designation FROM stage.property_unit_raw LIMIT 5;`;
  console.log(JSON.stringify({ count: result, samples }, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  await prisma.$disconnect();
}
main();
