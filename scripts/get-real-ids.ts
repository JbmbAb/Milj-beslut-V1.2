import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const doc = await prisma.documentRecord.findFirst();
  if (doc) {
    console.log(`FOUND_ORG_ID: ${doc.organisationId}`);
    console.log(`FOUND_PROJ_ID: ${doc.projectId}`);
  } else {
    console.log('No documents found in DocumentRecord');
  }
  await prisma.$disconnect();
}

main();
