import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const atts = await prisma.outlookAttachment.count();
  const emails = await prisma.emailMessage.count();
  const reqs = await prisma.extractedRequirement.count();
  const batches = await prisma.postgisImportBatch.count();
  console.log(JSON.stringify({ atts, emails, reqs, batches }));
}
main().catch(console.error).finally(() => prisma.$disconnect());
