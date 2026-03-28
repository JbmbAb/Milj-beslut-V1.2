import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<any[]>`SELECT designation, imported_at FROM stage.property_unit_raw ORDER BY imported_at DESC LIMIT 10;`;
  rows.forEach(r => console.log(`${r.imported_at}: ${r.designation}`));
  await prisma.$disconnect();
}
main();
