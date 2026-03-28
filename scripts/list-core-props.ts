import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const coreRows = await prisma.$queryRaw<any[]>`SELECT designation FROM core.property_unit LIMIT 10;`;
  console.log("Designations in core.property_unit:");
  coreRows.forEach(r => console.log(` - ${r.designation}`));
  
  const total = await prisma.$queryRaw<any[]>`SELECT count(*) FROM core.property_unit;`;
  console.log(`Total: ${total[0].count}`);
  
  await prisma.$disconnect();
}
main();
