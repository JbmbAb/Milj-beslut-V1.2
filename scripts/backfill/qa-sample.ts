/**
 * Steg 10b – QA-stickprov (minst 100 cases)
 * Skriver rapport med precision-estimates för municipality och diarie.
 * Kör: npx tsx scripts/backfill/qa-sample.ts [--size=100]
 *
 * NOTERA: Precision beräknas mot manuell granskning.
 * Skriptet skriver ut samples för manuell verifiering och beräknar
 * automatisk proxy-precision (dvs. hur många har både normaliserat kommunnamn och diarie).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../server/db/prisma';
import { arg } from './_shared';

async function main() {
    const size = Math.max(100, Number(arg('size') || 100));

    const total = await prisma.requirementCase.count();
    if (total === 0) {
        console.error('No RequirementCase rows found – run materialize-cases first.');
        process.exit(1);
    }

    // Random sample via TABLESAMPLE or ORDER BY RANDOM()
    const sample = await prisma.$queryRawUnsafe<Array<{
        caseKey: string;
        municipality: string | null;
        diarienummer: string | null;
        documentType: string | null;
        reviewStatus: string;
        caseReviewStatus: string;
        caseConfidence: number;
        sourceSubject: string | null;
    }>>(
        `SELECT
       rc."caseKey", rc.municipality, rc.diarienummer, rc."documentType",
       rc."reviewStatus", rc."caseReviewStatus",
       cc."caseConfidence",
       rc."sourceSubject"
     FROM "RequirementCase" rc
     LEFT JOIN "CaseCandidate" cc ON cc."caseKey" = rc."caseKey"
     ORDER BY random()
     LIMIT $1;`,
        size,
    );

    // Auto-metrics (proxy for precision – not a substitute for manual QA)
    const withMuni = sample.filter((r) => r.municipality).length;
    const withDiarie = sample.filter((r) => r.diarienummer).length;
    const withDecision = sample.filter((r) => r.documentType).length;
    const highConf = sample.filter((r) => (r.caseConfidence ?? 0) >= 0.70).length;
    const verified = sample.filter((r) => r.caseReviewStatus === 'VERIFIED' || r.caseReviewStatus === 'LOCKED').length;
    const needsReview = sample.filter((r) => r.caseReviewStatus === 'NEEDS_REVIEW').length;

    /**
     * VIKTIGT – confidence vs verifierad sanning
     * AUTO = datorextraherat, ej manuellt granskat
     * NEEDS_REVIEW = låg confidence, kräver granskning
     * VERIFIED = manuellt godkänt av handläggare
     * LOCKED = låst, får ej överskrivas automatiskt
     */
    const report = {
        generatedAt: new Date().toISOString(),
        sampleSize: sample.length,
        totalCases: total,
        autoMetrics: {
            municipalityFilled: { count: withMuni, pct: (withMuni / sample.length * 100).toFixed(1) + '%' },
            diarieFilled: { count: withDiarie, pct: (withDiarie / sample.length * 100).toFixed(1) + '%' },
            decisionTypeFilled: { count: withDecision, pct: (withDecision / sample.length * 100).toFixed(1) + '%' },
        },
        qualityDistribution: {
            highConfidence: { count: highConf, pct: (highConf / sample.length * 100).toFixed(1) + '%', note: 'caseConfidence >= 0.70' },
            verified: { count: verified, note: 'caseReviewStatus = VERIFIED or LOCKED – manuellt godkänt' },
            needsReview: { count: needsReview, note: 'caseReviewStatus = NEEDS_REVIEW – kräver manuell granskning' },
            auto: { count: sample.length - verified - needsReview, note: 'AUTO – datorextraherat, ej manuellt granskat' },
        },
        /**
         * MANUELL QA-INSTRUKTION:
         * Gå igenom sample nedan. För varje case:
         * 1. Kontrollera att municipality stämmer med diaries källa.
         * 2. Notera om diarienummer verkar korrekt.
         * 3. Beräkna: (antal korrekta) / (sample.length) = precision.
         * Precision < 0.90 för municipality eller diarie → kör coverage-report som fail-gate.
         */
        sampleForManualReview: sample.slice(0, 25),  // Print first 25 for quick review
        note: 'Full sample written to log file. See qualityDistribution for confidence vs. verified distinction.',
    };

    console.log(JSON.stringify(report, null, 2));

    const outDir = path.join(process.cwd(), 'logs', 'backfill');
    await fs.mkdir(outDir, { recursive: true });
    const filename = `qa-sample-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    // Write full sample to file
    await fs.writeFile(path.join(outDir, filename), JSON.stringify({ ...report, fullSample: sample }, null, 2), 'utf8');
    console.error(`\nFull QA sample → logs/backfill/${filename}`);
    console.error(`\n⚠️  REMINDER: AUTO ≠ VERIFIED. Do not treat caseConfidence as a substitute for manual verification.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
