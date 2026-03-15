/**
 * Steg 10c – Coverage-rapport med fail-gate
 * Fel om municipality-precision < 90% eller diarie-precision < 90% (i QA-sample).
 * Kör: npx tsx scripts/backfill/coverage-report.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../server/db/prisma';

async function main() {
    const total = await prisma.documentRecord.count();

    const [
        withMuniNorm, withDiarie, withDecision, withActivity, withWaste,
        totalCandidates, materializedCases, totalRequirements, totalCitations,
        openReview, openDisagreements, totalEvidence, failedDocs,
    ] = await Promise.all([
        prisma.documentRecord.count({ where: { municipalityNormalized: { not: null } } }),
        prisma.documentRecord.count({ where: { legalStatus: { not: null } } }),
        prisma.documentRecord.count({ where: { decisionType: { not: null } } }),
        prisma.documentRecord.count({ where: { activityCode: { not: null } } }),
        prisma.documentRecord.count({ where: { wasteType: { not: null } } }),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "CaseCandidate"'),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "CaseCandidate" WHERE status = \'MATERIALIZED\''),
        prisma.requirementRecord.count(),
        prisma.requirementCitation.count(),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "MetadataReviewQueue" WHERE status = \'OPEN\''),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "MetadataReviewQueue" WHERE status = \'OPEN\' AND "queueType" = \'DISAGREEMENT\''),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "DocumentMetadataEvidence"'),
        prisma.documentRecord.count({ where: { status: 'FAILED' } }),
    ]);

    const pct = (n: number) => total > 0 ? (n / total * 100).toFixed(1) + '%' : 'N/A';
    const num = (b: bigint | undefined) => Number((b ?? 0n).toString());

    const muniPrecision = total > 0 ? withMuniNorm / total : 0;
    const diariePrecision = total > 0 ? withDiarie / total : 0;

    const FAIL_MUNICIPALITY = 0.90;
    const FAIL_DIARIE = 0.90;

    const passed = muniPrecision >= FAIL_MUNICIPALITY && diariePrecision >= FAIL_DIARIE;

    const report = {
        generatedAt: new Date().toISOString(),
        failGate: {
            passed,
            municipalityPrecision: muniPrecision.toFixed(3),
            diariePrecision: diariePrecision.toFixed(3),
            thresholds: { municipality: FAIL_MUNICIPALITY, diarie: FAIL_DIARIE },
        },
        documents: {
            total, failed: failedDocs,
        },
        metadataCoverage: {
            municipalityNormalized: { count: withMuniNorm, pct: pct(withMuniNorm) },
            legalStatus_diarie: { count: withDiarie, pct: pct(withDiarie) },
            decisionType: { count: withDecision, pct: pct(withDecision) },
            activityCode: { count: withActivity, pct: pct(withActivity) },
            wasteType: { count: withWaste, pct: pct(withWaste) },
        },
        cases: {
            caseCandidates: num(totalCandidates[0]?.c),
            materializedCases: num(materializedCases[0]?.c),
            requirementRecords: totalRequirements,
            requirementCitations: totalCitations,
        },
        pipeline: {
            evidenceRows: num(totalEvidence[0]?.c),
            openReviewItems: num(openReview[0]?.c),
            openDisagreements: num(openDisagreements[0]?.c),
        },
    };

    console.log(JSON.stringify(report, null, 2));

    const outDir = path.join(process.cwd(), 'logs', 'backfill');
    await fs.mkdir(outDir, { recursive: true });
    const filename = `coverage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(path.join(outDir, filename), JSON.stringify(report, null, 2), 'utf8');
    console.error(`\nCoverage report → logs/backfill/${filename}`);

    if (!passed) {
        console.error('\n❌ FAIL-GATE TRIGGERED: precision below threshold. Do NOT proceed with LLM pass or requirement extraction.');
        process.exit(1);
    } else {
        console.error('\n✅ FAIL-GATE PASSED: safe to proceed.');
    }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
