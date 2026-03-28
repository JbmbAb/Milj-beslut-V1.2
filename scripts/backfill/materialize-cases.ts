/**
 * Steg 9 – Materialisera RequirementCase från CaseCandidate
 * Kör: npx tsx scripts/backfill/materialize-cases.ts [--dry-run]
 */
import { prisma } from '../../server/db/prisma';
import { flag, startPipelineRun, finishPipelineRun, failPipelineRun } from './_shared';

async function main() {
    const dryRun = flag('dry-run');
    const runId = await startPipelineRun({ runType: 'MATERIALIZE_CASES', stageName: 'materialize-cases', config: { dryRun } });
    let processed = 0;
    let errors = 0;

    try {
        // Only materialize candidates with no open disagreements and over confidence threshold
        const candidates = await prisma.$queryRawUnsafe<Array<{
            id: string; caseKey: string; documentIds: string; municipality: string | null;
            diarie: string | null; decisionType: string | null; activityCode: string | null;
            wasteType: string | null; caseConfidence: number;
        }>>(
            `SELECT cc.*
       FROM "CaseCandidate" cc
       WHERE cc.status = 'CANDIDATE'
         AND cc."caseConfidence" >= 0.45
         AND NOT EXISTS (
           SELECT 1 FROM "MetadataReviewQueue" mq
           WHERE mq."documentId" = ANY(SELECT jsonb_array_elements_text(cc."documentIds"))
             AND mq.status = 'OPEN'
             AND mq."queueType" = 'DISAGREEMENT'
         )
       ORDER BY cc."caseConfidence" DESC;`
        );

        for (const cand of candidates) {
            const docIds: string[] = Array.isArray(cand.documentIds)
                ? cand.documentIds as unknown as string[]
                : JSON.parse(cand.documentIds as unknown as string);
            // Use primary doc (highest municipality confidence)
            const primaryDoc = await prisma.documentRecord.findFirst({
                where: { id: { in: docIds } },
                orderBy: { municipalityConfidence: 'desc' },
                select: { id: true, projectId: true, organisationId: true, originalName: true, subject: true },
            });
            if (!primaryDoc) continue;

            const reviewStatus = cand.caseConfidence >= 0.70 ? 'AUTO' : 'NEEDS_REVIEW';

            try {
                if (!dryRun) {
                    await prisma.requirementCase.upsert({
                        where: { caseKey: cand.caseKey },
                        create: {
                            caseKey: cand.caseKey,
                            projectId: primaryDoc.projectId,
                            documentId: primaryDoc.id,
                            organisationId: primaryDoc.organisationId,
                            municipality: cand.municipality,
                            authorityType: 'Kommun',
                            authorityName: cand.municipality,
                            diarienummer: cand.diarie,
                            documentType: cand.decisionType,
                            sourceFile: primaryDoc.originalName,
                            sourceSubject: primaryDoc.subject,
                            reviewStatus: reviewStatus as 'AUTO' | 'NEEDS_REVIEW',
                            caseReviewStatus: reviewStatus,
                        },
                        update: {
                            municipality: cand.municipality,
                            authorityName: cand.municipality,
                            diarienummer: cand.diarie,
                            documentType: cand.decisionType,
                            reviewStatus: reviewStatus as 'AUTO' | 'NEEDS_REVIEW',
                            caseReviewStatus: reviewStatus,
                        },
                    });

                    // Mark candidate as materialized
                    await prisma.$executeRawUnsafe(
                        `UPDATE "CaseCandidate" SET status = 'MATERIALIZED', "updatedAt" = NOW() WHERE id = $1;`,
                        cand.id,
                    );
                }
                processed++;
            } catch (e) {
                console.error(`Error materializing case ${cand.caseKey}:`, e);
                errors++;
            }
        }

        await finishPipelineRun(runId, processed, errors);
    } catch (e) {
        await failPipelineRun(runId, e);
        throw e;
    }

    console.log(JSON.stringify({ runId, dryRun, processed, errors }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
