import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Listing All Tables In Database ===');
  const tables = await p.$queryRawUnsafe<any[]>(
    `SELECT table_schema, table_name 
     FROM information_schema.tables 
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema') 
     ORDER BY table_schema, table_name`
  );

  const schemas: Record<string, string[]> = {};
  for (const t of tables) {
    if (!schemas[t.table_schema]) {
      schemas[t.table_schema] = [];
    }
    schemas[t.table_schema].push(t.table_name);
  }

  for (const [schema, tbls] of Object.entries(schemas)) {
    console.log(`\nSchema: ${schema} (${tbls.length} tables)`);
    for (const t of tbls) {
      // Försök hämta radantal om det inte är en vy
      try {
        const [{ count }] = await p.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*) as count FROM "${schema}"."${t}"`
        );
        console.log(`  - ${t.padEnd(50)} : ${Number(count).toLocaleString('sv-SE')} rows`);
      } catch (err: any) {
        console.log(`  - ${t.padEnd(50)} : (Error or view: ${err.message.split('\n')[0]})`);
      }
    }
  }
}

main().catch(console.error).finally(() => p.$disconnect());
