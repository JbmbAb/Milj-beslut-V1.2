import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Checking tables in 'stage' and 'core' schemas...");
  const tables = await prisma.$queryRaw<any[]>`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('stage', 'core')
    ORDER BY table_schema, table_name;
  `;
  console.log(JSON.stringify(tables, null, 2));
  
  console.log("\nChecking columns in core.property_unit...");
  try {
    const cols = await prisma.$queryRaw<any[]>`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'core' AND table_name = 'property_unit';
    `;
    console.log(JSON.stringify(cols, null, 2));
  } catch (e: any) {
    console.error("Failed to get columns:", e.message);
  }

  await prisma.$disconnect();
}
main();
