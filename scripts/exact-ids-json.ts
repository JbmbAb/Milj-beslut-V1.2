import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  const doc = await prisma.documentRecord.findFirst();
  const org = await prisma.organisation.findFirst();
  const proj = await prisma.project.findFirst();
  
  const data = {
    DOC_PID: doc?.projectId,
    DOC_OID: doc?.organisationId,
    FIRST_PROJ_ID: proj?.id,
    FIRST_ORG_ID: org?.id,
    TOTAL_DOCS: await prisma.documentRecord.count(),
  };
  
  fs.writeFileSync('scripts/ids_debug.json', JSON.stringify(data, null, 2));
  console.log('Written to scripts/ids_debug.json');

  await prisma.$disconnect();
}

main();
