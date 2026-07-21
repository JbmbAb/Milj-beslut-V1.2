import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Active Municipalities and Regions in App ===');
  try {
    const cases = await p.$queryRawUnsafe<any[]>(
      `SELECT municipality, COUNT(*) as count 
       FROM "RequirementCase" 
       GROUP BY municipality 
       ORDER BY count DESC`
    );
    
    if (cases.length === 0) {
      console.log('No cases found in RequirementCase table.');
    } else {
      for (const c of cases) {
        console.log(`- ${String(c.municipality || 'Unknown').padEnd(25)} : ${c.count} cases`);
      }
    }
  } catch (err: any) {
    console.log('Error checking cases:', err.message);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
