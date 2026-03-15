import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organisation.findFirst();
  const project = await prisma.project.findFirst();
  
  console.log('ORG_ID:', org?.id);
  console.log('PROJECT_ID:', project?.id);
  
  await prisma.$disconnect();
}

main();
