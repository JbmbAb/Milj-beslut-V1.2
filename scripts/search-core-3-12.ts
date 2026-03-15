import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<any[]>`SELECT designation FROM core.property_unit WHERE designation LIKE '%3:12%' ORDER BY designation;`;
  console.log(`Found ${rows.length} matches in core:`);
  console.log(JSON.stringify(rows.map(r => r.designation), null, 2));
  await prisma.$disconnect();
}
main();
