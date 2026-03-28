import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const result: any = {};
  
  try {
    const databases: any = await prisma.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datistemplate = false');
    result.databases = databases.map((d: any) => d.datname);

    fs.writeFileSync('db-list.json', JSON.stringify(result, null, 2));
    console.log('Results saved to db-list.json');

  } catch (err) {
    console.error('Fel:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
