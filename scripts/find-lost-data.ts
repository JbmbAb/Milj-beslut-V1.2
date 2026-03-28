import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const result: any = { db: 'riskguard' };
  
  try {
    // Top 20 tabeller efter storlek (inkluderar index, rader etc)
    const bigTables: any = await prisma.$queryRaw`
      SELECT 
        schemaname as schema, 
        relname as table, 
        n_live_tup::text as row_count_estimate,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 20
    `;

    result.bigTables = bigTables;

    fs.writeFileSync('db-size-results.json', JSON.stringify(result, null, 2));
    console.log('Results saved to db-size-results.json');

  } catch (err) {
    console.error('Fel vid undersökning av storlek:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
