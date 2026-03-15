import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.resolve('scripts/db/create_property_unit_pipeline.sql');
  const sqlStr = fs.readFileSync(sqlPath, 'utf8');
  
  // Split by semicolon and run each statement
  const statements = sqlStr.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  for (const statement of statements) {
    try {
      console.log(`Running: ${statement.substring(0, 50)}...`);
      await prisma.$executeRawUnsafe(statement);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
  }
  
  await prisma.$disconnect();
}

main();
