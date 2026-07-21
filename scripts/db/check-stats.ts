import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = {
    organisations: await prisma.organisation.count(),
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    documents: await prisma.documentRecord.count(),
    plans: await prisma.projectPlanState.count(),
    requirements: await prisma.requirementRecord.count(),
  };

  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
