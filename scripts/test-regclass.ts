import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT to_regclass('stage.property_unit_raw')::text AS regclass
  `;
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main();
