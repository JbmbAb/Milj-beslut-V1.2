import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Checking for Källor / Springs from SGU ===');
  
  // Sök efter tabeller
  const tables = await p.$queryRawUnsafe<any[]>(
    `SELECT table_schema, table_name 
     FROM information_schema.tables 
     WHERE table_name ILIKE '%kall%' OR table_name ILIKE '%spring%'`
  );
  
  console.log('Matching tables in DB:', tables);
}

main().catch(console.error).finally(() => p.$disconnect());
