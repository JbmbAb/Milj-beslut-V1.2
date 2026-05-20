import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.searchJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(jobs.map(j => ({
    id: j.id,
    type: j.type,
    status: j.status,
    error: j.error,
    attempts: j.attempts,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt
  })), null, 2));
  await prisma.$disconnect();
}

main();
