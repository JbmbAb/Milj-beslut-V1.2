import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Complete GIS Initialization ---');
  
  const sqlFiles = [
    'scripts/enable_postgis.sql',
    'scripts/db/create_sgu_layers_pipeline.sql',
    'scripts/db/create_property_unit_pipeline.sql'
  ];

  for (const fileRelPath of sqlFiles) {
    const fullPath = path.join('c:/Users/jimmy/Desktop/Examens arbete/Kod/Ny mapp/remix_-copy-of-miljöbeslut.se-portal', fileRelPath);
    console.log(`Processing ${fileRelPath}...`);
    
    try {
      const sql = await fs.readFile(fullPath, 'utf8');
      
      // Basic splitting - might be fragile for complex functions but should work for these scripts
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        try {
          // console.log(`Executing statement: ${statement.slice(0, 50)}...`);
          await prisma.$executeRawUnsafe(statement);
        } catch (e: any) {
          if (e.message.includes('already exists') || e.message.includes('redan finns')) {
            // console.log('  (Already exists, skipping)');
          } else {
            console.error(`  ❌ Failed: ${e.message}`);
          }
        }
      }
      console.log(`✅ ${fileRelPath} finished.`);
    } catch (err: any) {
      console.error(`❌ Error reading/processing ${fileRelPath}: ${err.message}`);
    }
  }

  console.log('--- Final Check ---');
  const gistIndexes = await prisma.$queryRawUnsafe(`
    SELECT n.nspname as schema, t.relname as table, i.relname as index
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_am am ON i.relam = am.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE am.amname = 'gist'
  `);
  console.log('✅ GIST Indexes:', JSON.stringify(gistIndexes, null, 2));

  await prisma.$disconnect();
}

main();
