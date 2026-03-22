import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Enabling PostGIS and Schemas ---');
  try {
    const sqlPath = 'c:/Users/jimmy/Desktop/Examens arbete/Kod/Ny mapp/remix_-copy-of-miljöbeslut.se-portal/scripts/enable_postgis.sql';
    const sql = await fs.readFile(sqlPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      console.log(`Executing: ${statement}`);
      await prisma.$executeRawUnsafe(statement);
    }
    
    console.log('✅ PostGIS and schemas enabled successfully.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
