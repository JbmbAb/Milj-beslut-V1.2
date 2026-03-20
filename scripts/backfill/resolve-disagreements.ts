/**
 * Steg 7 – Disagreement-detektor
 * Skapar DISAGREEMENT-ärenden i MetadataReviewQueue, aldrig automatisk lösning.
 * Kör: npx tsx scripts/backfill/resolve-disagreements.ts [--dry-run]
 */
import { prisma } from '../../server/db/prisma';
import { flag, startPipelineRun, finishPipelineRun, failPipelineRun, enqueueReview } from './_shared';
import { dedupeReviewIntents, type ReviewQueueIntent } from './reviewQueueHelpers';

async function main() {
    const dryRun = flag('dry-run');
    const runId = await startPipelineRun({ runType: 'DISAGREEMENT', stageName: 'resolve-disagreements', config: { dryRun } });
    let processed = 0;
    const errors = 0;

    try {
        const intents: ReviewQueueIntent[] = [];

        // Rule 1: municipality in subject (pass1) ≠ municipality in document text (pass2)
        const muniDisagreements = await prisma.$queryRawUnsafe<Array<{ documentId: string; val1: string; val2: string }>>(
            `SELECT e1."documentId", e1."fieldValue" AS val1, e2."fieldValue" AS val2
       FROM "DocumentMetadataEvidence" e1
       JOIN "DocumentMetadataEvidence" e2
         ON e1."documentId" = e2."documentId"
        AND e1."fieldName" = 'municipality'
        AND e2."fieldName" = 'municipality'
        AND e1."sourceType" = 'subject_regex'
        AND e2."sourceType" = 'text_regex'
        AND e1."fieldValue" IS DISTINCT FROM e2."fieldValue"
       WHERE NOT EXISTS (
         SELECT 1 FROM "MetadataReviewQueue" mq
         WHERE mq."documentId" = e1."documentId"
           AND mq."queueType" = 'DISAGREEMENT'
           AND mq."fieldName" = 'municipality'
           AND mq."status" = 'OPEN'
       );`
        );

        for (const row of muniDisagreements) {
            intents.push({
                documentId: row.documentId,
                queueType: 'DISAGREEMENT',
                fieldName: 'municipality',
                proposedValue: null,
                confidence: null,
                reason: `subject says "${row.val1}" but doc text says "${row.val2}"`,
            });
        }

        // Rule 2: Multiple diarienummer in same case candidate
        const diarieDisagreements = await prisma.$queryRawUnsafe<Array<{ caseKey: string; docIds: string }>>(
            `SELECT cc."caseKey", cc."documentIds"::text AS "docIds"
       FROM "CaseCandidate" cc
       WHERE cc.status = 'CANDIDATE'
         AND jsonb_array_length(cc."documentIds") > 1
         AND (
           SELECT COUNT(DISTINCT dr."legalStatus")
           FROM "DocumentRecord" dr
           WHERE dr.id = ANY(
             SELECT jsonb_array_elements_text(cc."documentIds")
           )
           AND dr."legalStatus" IS NOT NULL
         ) > 1;`
        );

        for (const row of diarieDisagreements) {
            const docIds: string[] = JSON.parse(row.docIds);
            for (const docId of docIds) {
                intents.push({
                    documentId: docId,
                    queueType: 'DISAGREEMENT',
                    fieldName: 'legalStatus',
                    proposedValue: null,
                    confidence: null,
                    reason: `multiple diarie numbers in same case candidate (${row.caseKey})`,
                });
            }
        }

        // Rule 3: Multiple activityCodes in same candidate
        const actDisagreements = await prisma.$queryRawUnsafe<Array<{ caseKey: string; docIds: string }>>(
            `SELECT cc."caseKey", cc."documentIds"::text AS "docIds"
       FROM "CaseCandidate" cc
       WHERE cc.status = 'CANDIDATE'
         AND (
           SELECT COUNT(DISTINCT dr."activityCode")
           FROM "DocumentRecord" dr
           WHERE dr.id = ANY(SELECT jsonb_array_elements_text(cc."documentIds"))
             AND dr."activityCode" IS NOT NULL
         ) > 1;`
        );

        for (const row of actDisagreements) {
            const docIds: string[] = JSON.parse(row.docIds);
            for (const docId of docIds) {
                intents.push({
                    documentId: docId,
                    queueType: 'DISAGREEMENT',
                    fieldName: 'activityCode',
                    proposedValue: null,
                    confidence: null,
                    reason: `multiple activityCodes in same case candidate (${row.caseKey})`,
                });
            }
        }

        const dedupedIntents = dedupeReviewIntents(intents);
        processed = dedupedIntents.length;

        if (!dryRun) {
            for (const intent of dedupedIntents) {
                await enqueueReview(intent);
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
