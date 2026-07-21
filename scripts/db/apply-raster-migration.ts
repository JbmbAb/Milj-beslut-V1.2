import * as fs from 'node:fs';
import * as path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const p = new PrismaClient();

async function main() {
  const migrationFile = path.join(process.cwd(), 'prisma', 'migrations', '20260628_raster_outdb_infrastructure.sql');
  console.log(`Reading migration from: ${migrationFile}`);
  
  if (!fs.existsSync(migrationFile)) {
    console.error('Migration file not found!');
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationFile, 'utf8');

  // Split SQL by semicolon, clean up comments and empty statements
  const statements = sql
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => {
      // Remove SQL comments
      const cleaned = stmt.replace(/--.*$/gm, '').trim();
      return cleaned.length > 0;
    });

  console.log(`Applying ${statements.length} migration statements...`);
  
  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      // Re-add semicolon at the end
      const query = stmt + ';';
      console.log(`Executing statement ${i + 1}/${statements.length}...`);
      await p.$executeRawUnsafe(query);
    }
    console.log('✅ Migration applied successfully.');
  } catch (e: any) {
    console.error('❌ Error applying migration:', e.message);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();
