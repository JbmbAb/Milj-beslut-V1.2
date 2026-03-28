import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const result: any = {};
  
  try {
    const tables: any = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;

    result.counts = {};
    for (const t of tables) {
      try {
        const count: any = await prisma.$queryRawUnsafe(`SELECT count(*) FROM "${t.table_name}"`);
        result.counts[t.table_name] = String(count[0].count);
      } catch {
        result.counts[t.table_name] = 'ERROR';
      }
    }

    fs.writeFileSync('db-full-inventory.json', JSON.stringify(result, null, 2));
    console.log('Inventory saved to db-full-inventory.json');

  } catch (err) {
    console.error('Fel:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
