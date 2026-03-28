import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.resolve('scripts/db/merge_property_unit_stage_to_core.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  // Split by semicolon but ignore inside quotes/functions? 
  // Actually, this script is simple, just one big INSERT.
  console.log('Running merge SQL...');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  for (const statement of statements) {
    try {
      console.log(`Running: ${statement.substring(0, 50)}...`);
      await prisma.$executeRawUnsafe(statement);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
  }
  console.log('Merge complete.');
  await prisma.$disconnect();
}

main();
