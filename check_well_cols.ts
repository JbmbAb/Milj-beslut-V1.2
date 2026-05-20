import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  try {
    const cols = await prisma.$queryRawUnsafe<any[]>('SELECT column_name FROM information_schema.columns WHERE table_schema = \'env\' AND table_name = \'sgu_well\'');
    console.log('Columns in env.sgu_well:', cols.map(c => c.column_name));
  } finally {
    await prisma.$disconnect();
  }
}

check();
