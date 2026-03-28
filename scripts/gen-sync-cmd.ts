import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organisation.findFirst();
  const project = await prisma.project.findFirst();
  
  if (!org || !project) {
    console.error('No org or project found');
    return;
  }
  
  console.log(`npx tsx scripts/import/idempotent-ingest.ts --input="C:\\Users\\jimmy\\Desktop\\OutlookExport\\manifest.csv" --project-id=${project.id} --organisation-id=${org.id}`);
  
  await prisma.$disconnect();
}

main();
