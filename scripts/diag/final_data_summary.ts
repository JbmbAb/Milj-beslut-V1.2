import { PrismaClient } from '@prisma/client';
import { buildCoverageReport } from '../backfill/coverageHelpers';

async function main() {
  const prisma = new PrismaClient();
  try {
    const totalDocs = await prisma.documentRecord.count();
    const failedDocs = await prisma.documentRecord.count({ where: { status: 'FAILED' } });
    const municipalityCount = await prisma.documentRecord.count({ where: { municipality: { not: null } } });
    const diarieCount = await prisma.documentRecord.count({ where: { legalStatus: { startsWith: 'Diarie:' } } });
    const decisionTypeCount = await prisma.documentRecord.count({ where: { decisionType: { not: null } } });
    
    const reqCount = await prisma.requirementRecord.count();
    const caseCount = await prisma.requirementCase.count();

    const report = buildCoverageReport({
      totalDocuments: totalDocs,
      failedDocuments: failedDocs,
      municipalityCount,
      diarieCount,
      decisionTypeCount,
      activityCodeCount: 0,
      wasteTypeCount: 0,
      caseCandidates: 0,
      materializedCases: caseCount,
      requirementRecords: reqCount,
      requirementCitations: 0,
      evidenceRows: 0,
      openReviewItems: 0,
      openDisagreements: 0,
    });

    console.log('--- FINAL DATA COVERAGE SUMMARY ---');
    console.log('Total Documents:', totalDocs);
    console.log('Eligible (not failed):', report.documents.eligible);
    console.log('Municipality Coverage:', report.metadataCoverage.municipalityNormalized.pctOfEligibleDocuments);
    console.log('Diarie Coverage:', report.metadataCoverage.legalStatus_diarie.pctOfAllDocuments);
    console.log('Requirements Extracted:', reqCount);
    console.log('Unique Cases:', caseCount);
    console.log('Passes Quality Gate:', report.failGate.passed ? 'YES' : 'NO');
    
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
