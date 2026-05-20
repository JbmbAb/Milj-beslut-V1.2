import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT count(*) FROM information_schema.tables 
    WHERE table_schema = 'stage' AND table_name = 'property_unit_raw'
  `;
  console.log(JSON.stringify(result, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  await prisma.$disconnect();
}

main();
