import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Checking all case tables for municipality info ===');

  const queries = [
    { table: 'sewage_application_cases', col: 'municipality' },
    { table: 'decision_cases', col: 'municipality' },
    { table: 'municipality_decision_profile', col: 'municipality_code' },
  ];

  for (const q of queries) {
    try {
      const res = await p.$queryRawUnsafe<any[]>(
        `SELECT "${q.col}" as val, COUNT(*) as count 
         FROM "${q.table}" 
         GROUP BY "${q.col}" 
         ORDER BY count DESC`,
      );
      console.log(`\nTable ${q.table}:`);
      if (res.length === 0) {
        console.log('  (Empty)');
      } else {
        for (const row of res) {
          console.log(`  - ${row.val} : ${row.count} rows`);
        }
      }
    } catch (err: any) {
      console.log(`\nTable ${q.table}: MISSING or error (${err.message})`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
