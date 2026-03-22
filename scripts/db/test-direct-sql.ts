import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const req = {
    id: 'test-direct-id',
    requirementCode: 'REQ-4c92301c64fb82bf128e856c',
    caseId: 'cmmfvsrwy0001cumw55qi3g85', // Using an ID from previous debug output
    documentId: 'cmm4yund000kbcuqwc45lecot',
    projectId: 'cmm4yrse10004cunkvow2wny6',
    sourceType: 'DIRECT_SQL',
    category: 'Test',
    subcategory: 'Test',
    requirementTextQuote: 'Test',
    interpretedRequirement: 'Test',
    level: 'MANDATORY',
    verificationStatus: 'AUTO',
    updatedAt: new Date(),
    createdAt: new Date(),
  };

  try {
    // Check if case exists first
    const c = await prisma.requirementCase.findUnique({ where: { id: req.caseId } });
    if (!c) {
      // Create dummy case
      await prisma.requirementCase.create({
        data: {
          id: req.caseId,
          caseKey: 'DEBUG-CASE',
          projectId: req.projectId,
          documentId: req.documentId,
          organisationId: 'clv1234dummyorg',
          sourceFile: 'test.pdf',
        },
      });
    }

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "RequirementRecord" ("id", "requirementCode", "caseId", "documentId", "projectId", "sourceType", "category", "subcategory", "requirementTextQuote", "interpretedRequirement", "level", "verificationStatus", "updatedAt", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `,
      req.id,
      req.requirementCode,
      req.caseId,
      req.documentId,
      req.projectId,
      req.sourceType,
      req.category,
      req.subcategory,
      req.requirementTextQuote,
      req.interpretedRequirement,
      req.level,
      req.verificationStatus,
      req.updatedAt,
      req.createdAt,
    );

    console.log('Direct SQL insert worked');
  } catch (e: any) {
    console.error('Direct SQL insert failed:', e.message);
  }
}
main().finally(() => prisma.$disconnect());
