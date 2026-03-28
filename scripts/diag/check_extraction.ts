import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const docCount = await prisma.documentRecord.count();
    const reqCount = await prisma.requirementRecord.count();
    const extractRuns = await prisma.$queryRawUnsafe("SELECT * FROM ingest_runs WHERE run_id LIKE 'extract_20260326%' ORDER BY started_at DESC;");
    console.log({ docCount, reqCount, extractRuns });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
