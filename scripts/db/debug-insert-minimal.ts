import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const caseRow = await prisma.requirementCase.findFirst();
  if (!caseRow) {
    console.log('No case found');
    return;
  }

  try {
    const res = await prisma.requirementRecord.create({
      data: {
        requirementCode: 'DEBUG-REQ-' + Date.now(),
        requirementHash: 'hash-' + Date.now(),
        caseId: caseRow.id,
        documentId: caseRow.documentId,
        projectId: caseRow.projectId,
        sourceType: 'DEBUG',
        category: 'TestCat',
        subcategory: 'TestSub',
        requirementTextQuote: 'Test Quote',
        interpretedRequirement: 'Test Interpreted',
        level: 'MANDATORY',
        updatedAt: new Date(), // Explicitly set updatedAt
      },
    });
    console.log('Success:', res.id);
  } catch (e: any) {
    console.error('FAILED with error:');
    console.error(JSON.stringify(e, null, 2));
    if (e.code) console.error('Error code:', e.code);
    if (e.meta) console.error('Meta:', JSON.stringify(e.meta, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
