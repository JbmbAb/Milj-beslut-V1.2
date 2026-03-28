import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const runs = await prisma.$queryRawUnsafe('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 5;');
    console.log(JSON.stringify(runs, null, 2));
  } catch (e) {
    console.error('Failed to query ingest_runs:', e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
