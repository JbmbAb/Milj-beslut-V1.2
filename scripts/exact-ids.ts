import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const doc = await prisma.documentRecord.findFirst();
  const org = await prisma.organisation.findFirst();
  const proj = await prisma.project.findFirst();
  
  console.log('--- EXACT IDS ---');
  console.log(`DOC_PID: ${doc?.projectId}`);
  console.log(`DOC_OID: ${doc?.organisationId}`);
  console.log(`FIRST_PROJ_ID: ${proj?.id}`);
  console.log(`FIRST_ORG_ID: ${org?.id}`);
  
  const docCount = await prisma.documentRecord.count();
  console.log(`TOTAL_DOCS: ${docCount}`);
  
  const parsedCount = await prisma.$queryRawUnsafe('SELECT count(*) FROM attachments WHERE parsed = TRUE');
  console.log(`PARSED_ATTACHMENTS: ${JSON.stringify(parsedCount, (k,v) => typeof v === "bigint" ? v.toString() : v)}`);

  await prisma.$disconnect();
}

main();
