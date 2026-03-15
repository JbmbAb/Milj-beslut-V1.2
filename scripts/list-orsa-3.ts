import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<any[]>`SELECT designation FROM stage.property_unit_raw WHERE designation LIKE 'ORSA STACKMORA 3:%' ORDER BY designation;`;
  console.log(JSON.stringify(rows.map(r => r.designation), null, 2));
  await prisma.$disconnect();
}
main();
