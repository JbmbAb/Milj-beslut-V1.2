import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Searching stage for '3:12'...");
  const hits = await prisma.$queryRaw<any[]>`SELECT designation FROM stage.property_unit_raw WHERE designation LIKE '%3:12%';`;
  console.log("Hits:", JSON.stringify(hits, null, 2));

  console.log("Searching stage for '3:'...");
  const partial = await prisma.$queryRaw<any[]>`SELECT designation FROM stage.property_unit_raw WHERE designation LIKE '%3:%' LIMIT 20;`;
  console.log("Partial Hits:", JSON.stringify(partial, null, 2));

  await prisma.$disconnect();
}
main();
