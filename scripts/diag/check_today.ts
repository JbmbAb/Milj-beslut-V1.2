import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const runs = await prisma.$queryRawUnsafe("SELECT run_id, run_type, status, started_at, finished_at FROM ingest_runs WHERE started_at > '2026-03-26T00:00:00Z' ORDER BY started_at DESC;");
    console.log(JSON.stringify(runs, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
