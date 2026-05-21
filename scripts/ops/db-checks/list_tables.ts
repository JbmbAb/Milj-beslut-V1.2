import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  try {
    const tables = await prisma.$queryRawUnsafe<any[]>('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = \'env\'');
    console.log('Tables in env schema:', tables.map(t => t.tablename));
  } catch (e: any) {
    console.error('Error checking tables:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
