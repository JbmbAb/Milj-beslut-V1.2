/**
 * Steg 1 – Baseline-rapport
 * Räknar coverage för kärnfält och skriver JSON till logs/backfill/baseline-<timestamp>.json
 *
 * Kör: npx tsx scripts/backfill/baseline-report.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../server/db/prisma';

async function main() {
    const [
        totalDocs,
        withText,
        withChunked,
        withEmbedded,
        withFailed,
        withMunicipality,
        withMunicipalityNorm,
        withLegalStatus,
        withDecisionType,
        withActivityCode,
        withWasteType,
        withMetaReviewAuto,
        withMetaReviewNeedsReview,
        totalCandidates,
        totalCases,
        totalRecords,
        totalCitations,
        totalEvidence,
        totalReviewQueue,
        openReviewQueue,
    ] = await Promise.all([
        prisma.documentRecord.count(),
        prisma.documentRecord.count({ where: { status: 'TEXT_EXTRACTED' } }),
        prisma.documentRecord.count({ where: { status: 'CHUNKED' } }),
        prisma.documentRecord.count({ where: { status: 'EMBEDDED' } }),
        prisma.documentRecord.count({ where: { status: 'FAILED' } }),
        prisma.documentRecord.count({ where: { municipality: { not: null } } }),
        prisma.documentRecord.count({ where: { municipalityNormalized: { not: null } } }),
        prisma.documentRecord.count({ where: { legalStatus: { not: null } } }),
        prisma.documentRecord.count({ where: { decisionType: { not: null } } }),
        prisma.documentRecord.count({ where: { activityCode: { not: null } } }),
        prisma.documentRecord.count({ where: { wasteType: { not: null } } }),
        prisma.documentRecord.count({ where: { metadataReviewStatus: 'AUTO' } }),
        prisma.documentRecord.count({ where: { metadataReviewStatus: 'NEEDS_REVIEW' } }),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "CaseCandidate"'),
        prisma.requirementCase.count(),
        prisma.requirementRecord.count(),
        prisma.requirementCitation.count(),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "DocumentMetadataEvidence"'),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "MetadataReviewQueue"'),
        prisma.$queryRawUnsafe<[{ c: bigint }]>('SELECT COUNT(*) AS c FROM "MetadataReviewQueue" WHERE status = \'OPEN\''),
    ]);

    const pct = (n: number) => totalDocs > 0 ? `${((n / totalDocs) * 100).toFixed(1)}%` : 'N/A';

    const report = {
        generatedAt: new Date().toISOString(),
        documents: {
            total: totalDocs,
            byStatus: {
                METADATA_ONLY: totalDocs - withText - withChunked - withEmbedded - withFailed,
                TEXT_EXTRACTED: withText,
                CHUNKED: withChunked,
                EMBEDDED: withEmbedded,
                FAILED: withFailed,
            },
        },
        metadataCoverage: {
            municipality: { count: withMunicipality, pct: pct(withMunicipality) },
            municipalityNormalized: { count: withMunicipalityNorm, pct: pct(withMunicipalityNorm) },
            legalStatus_diarie: { count: withLegalStatus, pct: pct(withLegalStatus) },
            decisionType: { count: withDecisionType, pct: pct(withDecisionType) },
            activityCode: { count: withActivityCode, pct: pct(withActivityCode) },
            wasteType: { count: withWasteType, pct: pct(withWasteType) },
        },
        reviewStatus: {
            AUTO: withMetaReviewAuto,
            NEEDS_REVIEW: withMetaReviewNeedsReview,
        },
        caseData: {
            caseCandidates: Number((totalCandidates[0]?.c ?? 0n).toString()),
            requirementCases: totalCases,
            requirementRecords: totalRecords,
            requirementCitations: totalCitations,
        },
        pipeline: {
            evidenceRows: Number((totalEvidence[0]?.c ?? 0n).toString()),
            reviewQueueTotal: Number((totalReviewQueue[0]?.c ?? 0n).toString()),
            reviewQueueOpen: Number((openReviewQueue[0]?.c ?? 0n).toString()),
        },
    };

    console.log(JSON.stringify(report, null, 2));

    const outDir = path.join(process.cwd(), 'logs', 'backfill');
    await fs.mkdir(outDir, { recursive: true });
    const filename = `baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(path.join(outDir, filename), JSON.stringify(report, null, 2), 'utf8');
    console.error(`\nBaseline report written to logs/backfill/${filename}`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
