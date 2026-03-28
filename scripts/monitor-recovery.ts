import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const chunks = await prisma.documentChunk.count();
  const reqs = await prisma.requirementRecord.count();
  const pendingJobs = await prisma.searchJob.count({ where: { status: 'PENDING' } });
  const doneJobs = await prisma.searchJob.count({ where: { status: 'DONE' } });
  const failedJobs = await prisma.searchJob.count({ where: { status: 'FAILED' } });

  console.log(`--- RECOVERY MONITOR ---`);
  console.log(`TIME: ${new Date().toISOString()}`);
  console.log(`CHUNKS: ${chunks}`);
  console.log(`REQUIREMENTS: ${reqs}`);
  console.log(`JOBS: PENDING=${pendingJobs}, DONE=${doneJobs}, FAILED=${failedJobs}`);
  console.log(`------------------------`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
