/**
 * Steg 10c – Coverage-rapport med fail-gate
 * Fel om municipality-precision < 90% eller diarie-precision < 90% (i QA-sample).
 * Kör: npx tsx scripts/backfill/coverage-report.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../server/db/prisma';
import { buildCoverageReport } from './coverageHelpers';

async function main() {
    const total = await prisma.documentRecord.count();
    const eligibleWhere = { status: { not: 'FAILED' as const } };

    const [
        withMuniNorm, withDiarie, withDecision, withActivity, withWaste,
        totalCandidates, materializedCases, totalRequirements, totalCitations,
        openReview, openDisagreements, totalEvidence, failedDocs,
    ] = await Promise.all([
        prisma.documentRecord.count({ where: { ...eligibleWhere, municipalityNormalized: { not: null } } }),
        prisma.documentRecord.count({ where: { ...eligibleWhere, legalStatus: { not: null } } }),
        prisma.documentRecord.count({ where: { ...eligibleWhere, decisionType: { not: null } } }),
        prisma.documentRecord.count({ where: { ...eligibleWhere, activityCode: { not: null } } }),
        prisma.documentRecord.count({ where: { ...eligibleWhere, wasteType: { not: null } } }),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "CaseCandidate"'),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "CaseCandidate" WHERE status = \'MATERIALIZED\''),
        prisma.requirementRecord.count(),
        prisma.requirementCitation.count(),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "MetadataReviewQueue" WHERE status = \'OPEN\''),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "MetadataReviewQueue" WHERE status = \'OPEN\' AND "queueType" = \'DISAGREEMENT\''),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "DocumentMetadataEvidence"'),
        prisma.documentRecord.count({ where: { status: 'FAILED' } }),
    ]);

    const num = (b: bigint | undefined) => Number((b ?? 0n).toString());
    const report = buildCoverageReport({
        totalDocuments: total,
        failedDocuments: failedDocs,
        municipalityCount: withMuniNorm,
        diarieCount: withDiarie,
        decisionTypeCount: withDecision,
        activityCodeCount: withActivity,
        wasteTypeCount: withWaste,
        caseCandidates: num(totalCandidates[0]?.c),
        materializedCases: num(materializedCases[0]?.c),
        requirementRecords: totalRequirements,
        requirementCitations: totalCitations,
        evidenceRows: num(totalEvidence[0]?.c),
        openReviewItems: num(openReview[0]?.c),
        openDisagreements: num(openDisagreements[0]?.c),
    });

    console.log(JSON.stringify(report, null, 2));

    const outDir = path.join(process.cwd(), 'logs', 'backfill');
    await fs.mkdir(outDir, { recursive: true });
    const filename = `coverage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(path.join(outDir, filename), JSON.stringify(report, null, 2), 'utf8');
    console.error(`\nCoverage report → logs/backfill/${filename}`);

    if (!report.failGate.passed) {
        console.error('\n❌ FAIL-GATE TRIGGERED: precision below threshold. Do NOT proceed with LLM pass or requirement extraction.');
        process.exit(1);
    } else {
        console.error('\n✅ FAIL-GATE PASSED: safe to proceed.');
    }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
