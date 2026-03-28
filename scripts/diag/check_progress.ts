import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.documentRecord.count();
    const ingestRuns = await prisma.$queryRawUnsafe("SELECT * FROM ingest_runs WHERE run_id LIKE 'ingest_20260326%' ORDER BY started_at DESC;");
    console.log({ count, ingestRuns });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
