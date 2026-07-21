import { PrismaClient } from '@prisma/client';
import { extractRequirementsFromText } from '../../server/services/requirementExtractionService';

const prisma = new PrismaClient();

async function main() {
  console.log('--- BATCH REQUIREMENT EXTRACTION ---');
  
  const attachments = await prisma.outlookAttachment.findMany({
    where: {
      NOT: { extractedText: null },
      requirements: { none: {} }
    },
    take: 100,
    include: {
      document: true
    }
  });

  console.log('Found ' + attachments.length + ' attachments to process.');

  let totalReqs = 0;
  for (const att of attachments) {
    if (!att.extractedText) continue;
    
    console.log('Processing: ' + att.filename + ' (' + att.attachmentHash.substring(0, 8) + ')...');
    
    const requirements = extractRequirementsFromText(att.extractedText);
    const municipality = att.document?.municipalityNormalized ?? att.document?.municipality ?? null;
    const caseNumber = att.document?.entryId ?? null;

    for (const req of requirements) {
      const requirementId = att.attachmentHash + '_' + Buffer.from(req.requirementText).toString('base64').slice(0, 20);
      await prisma.extractedRequirement.upsert({
        where: { id: requirementId },
        update: {
          municipality,
          caseNumber,
          category: req.category,
          requirementLevel: req.requirementLevel,
          legalReference: req.legalReference ?? null,
          confidence: req.confidence,
          pageNumber: req.pageNumber ?? null,
          sourceSegment: req.sourceSegment,
        },
        create: {
          id: requirementId,
          attachmentHash: att.attachmentHash,
          municipality,
          caseNumber,
          requirementText: req.requirementText,
          category: req.category,
          requirementLevel: req.requirementLevel,
          legalReference: req.legalReference ?? null,
          confidence: req.confidence,
          pageNumber: req.pageNumber ?? null,
          sourceSegment: req.sourceSegment,
        },
      });
      totalReqs++;
    }
  }

  console.log('Done! Created ' + totalReqs + ' requirement records.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
