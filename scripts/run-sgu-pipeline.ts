import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Running SGU Pipeline SQL ---');
  try {
    const sqlPath = 'c:/Users/jimmy/Desktop/Examens arbete/Kod/Ny mapp/remix_-copy-of-miljöbeslut.se-portal/scripts/db/create_sgu_layers_pipeline.sql';
    const sql = await fs.readFile(sqlPath, 'utf8');
    
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        console.log(`Executing: ${statement.slice(0, 100)}...`);
        await prisma.$executeRawUnsafe(statement);
      } catch (e: any) {
        console.error(`❌ Failed statement: ${e.message}`);
      }
    }
    
    console.log('✅ SGU Pipeline run finished.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
