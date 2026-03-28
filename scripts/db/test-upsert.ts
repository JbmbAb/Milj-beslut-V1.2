import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const caseRow = await prisma.requirementCase.findFirst();
  if (!caseRow) {
    console.log('No case found');
    return;
  }

  const requirementCode = 'REQ-TEST-SINGLE';
  try {
    const res = await prisma.requirementRecord.upsert({
      where: { requirementCode },
      update: { interpretedRequirement: 'Updated' },
      create: {
        requirementCode,
        caseId: caseRow.id,
        documentId: caseRow.documentId,
        projectId: caseRow.projectId,
        sourceType: 'TEST',
        category: 'Test',
        subcategory: 'Test',
        requirementTextQuote: 'Test',
        interpretedRequirement: 'Test',
        level: 'MANDATORY',
      },
    });
    console.log('Upsert worked:', res.id);
  } catch (e) {
    console.error('Upsert failed:', e);
  }
}
main().finally(() => prisma.$disconnect());
