import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const coreCols = await prisma.$queryRaw<any[]>`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'core' AND table_name = 'property_unit';
  `;
  const coreList = coreCols.map(c => c.column_name);
  console.log("Core Has Geom:", coreList.includes('geom'));
  console.log("Core Columns:", coreList);

  const stageCols = await prisma.$queryRaw<any[]>`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'stage' AND table_name = 'property_unit_raw';
  `;
  const stageList = stageCols.map(c => c.column_name);
  console.log("Stage Has Geom:", stageList.includes('geom'));
  console.log("Stage Columns:", stageList);

  await prisma.$disconnect();
}
main();
