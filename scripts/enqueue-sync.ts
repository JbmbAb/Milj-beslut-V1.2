import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst();
  if (!project) {
    console.error('No project found');
    return;
  }

  const job = await prisma.searchJob.create({
    data: {
      type: 'SYNC_MANIFEST',
      projectId: project.id,
      payload: {
        projectId: project.id,
        organisationId: project.organisationId,
      },
      status: 'PENDING',
    },
  });

  console.log('Enqueued SYNC_MANIFEST job:', job.id);
  await prisma.$disconnect();
}

main();
