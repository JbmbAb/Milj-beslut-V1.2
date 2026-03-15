import "dotenv/config";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Current DB:", (await prisma.$queryRaw<any[]>`SELECT current_database()`)[0].current_database);
  console.log("Current User:", (await prisma.$queryRaw<any[]>`SELECT current_user`)[0].current_user);
  
  try {
    const r = await prisma.$executeRawUnsafe('SELECT 1 FROM stage.property_unit_raw LIMIT 1');
    console.log("Success!");
  } catch (e: any) {
    console.error("Error Code:", e.code);
    console.error("Error Message:", e.message);
  }
  await prisma.$disconnect();
}
main();
