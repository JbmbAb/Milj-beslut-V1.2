import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const stageRows = await prisma.$queryRaw<any[]>`SELECT designation FROM stage.property_unit_raw ORDER BY designation LIMIT 100;`;
  console.log("Designations in stage.property_unit_raw:");
  stageRows.forEach(r => console.log(` - ${r.designation}`));
  await prisma.$disconnect();
}
main();
