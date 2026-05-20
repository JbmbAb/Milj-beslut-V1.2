/**
 * Engångsscript för att slå ihop duplicerade OPEN-poster i MetadataReviewQueue.
 * Behåller äldsta öppna posten per (documentId, queueType, fieldName),
 * sammanfogar reason/confidence/proposedValue och markerar resten som RESOLVED.
 *
 * Kör:
 *   npx tsx scripts/backfill/dedupe-review-queue.ts --dry-run
 *   npx tsx scripts/backfill/dedupe-review-queue.ts
 */
import { prisma } from '../../server/db/prisma';
import { failPipelineRun, finishPipelineRun, flag, startPipelineRun } from './_shared';
import { makeReviewIntentKey, mergeReviewReasons } from './reviewQueueHelpers';
import type { ReviewQueueIntent } from './reviewQueueHelpers';

type QueueRow = {
  id: string;
  documentId: string;
  queueType: ReviewQueueIntent["queueType"];
  fieldName: string;
  proposedValue: string | null;
  confidence: number | null;
  reason: string | null;
  createdAt: Date;
};

function isSupportedQueueType(value: string): value is ReviewQueueIntent["queueType"] {
  return value === "LOW_CONFIDENCE" || value === "DISAGREEMENT";
}

function pickMergedValue(rows: QueueRow[]): { proposedValue: string | null; confidence: number | null } {
  let bestValue: string | null = null;
  let bestConfidence: number | null = null;

  for (const row of rows) {
    if (row.proposedValue === null) continue;
    if (bestValue === null || (row.confidence ?? -1) > (bestConfidence ?? -1)) {
      bestValue = row.proposedValue;
      bestConfidence = row.confidence ?? null;
    }
  }

  if (bestValue === null) {
    bestConfidence = rows.reduce<number | null>((current, row) => {
      if (row.confidence === null) return current;
      return current === null ? row.confidence : Math.max(current, row.confidence);
    }, null);
  }

  return { proposedValue: bestValue, confidence: bestConfidence };
}

async function main() {
  const dryRun = flag('dry-run');
  const runId = await startPipelineRun({
    runType: 'REVIEW_QUEUE_DEDUPE',
    stageName: 'dedupe-review-queue',
    config: { dryRun },
  });

  let processed = 0;
  let errors = 0;

  try {
    const openItems = await prisma.metadataReviewQueue.findMany({
      where: { status: 'OPEN' },
      orderBy: [{ documentId: 'asc' }, { queueType: 'asc' }, { fieldName: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        documentId: true,
        queueType: true,
        fieldName: true,
        proposedValue: true,
        confidence: true,
        reason: true,
        createdAt: true,
      },
    });

    const grouped = new Map<string, QueueRow[]>();
    for (const item of openItems) {
      if (!isSupportedQueueType(item.queueType)) {
        continue;
      }
      const normalizedItem: QueueRow = {
        ...item,
        queueType: item.queueType,
      };
      const key = makeReviewIntentKey(normalizedItem);
      const rows = grouped.get(key) ?? [];
      rows.push(normalizedItem);
      grouped.set(key, rows);
    }

    let duplicateGroups = 0;
    let redundantRows = 0;
    let keeperUpdates = 0;

    for (const rows of grouped.values()) {
      if (rows.length <= 1) continue;

      duplicateGroups++;
      redundantRows += rows.length - 1;
      processed += rows.length;

      const keeper = rows[0];
      const duplicates = rows.slice(1);
      const mergedReason = mergeReviewReasons(...rows.map((row) => row.reason), `deduped ${duplicates.length} duplicate open queue rows`);
      const mergedValue = pickMergedValue(rows);

      if (!dryRun) {
        await prisma.$transaction([
          prisma.metadataReviewQueue.update({
            where: { id: keeper.id },
            data: {
              proposedValue: mergedValue.proposedValue,
              confidence: mergedValue.confidence,
              reason: mergedReason,
            },
          }),
          ...duplicates.map((row) =>
            prisma.metadataReviewQueue.update({
              where: { id: row.id },
              data: {
                status: 'RESOLVED',
                reviewedBy: 'system:dedupe-review-queue',
                reviewedAt: new Date(),
                reason: mergeReviewReasons(row.reason, `auto-deduped into open queue item ${keeper.id}`),
              },
            }),
          ),
        ]);
      }

      keeperUpdates++;
    }

    await finishPipelineRun(runId, processed, errors);
    console.log(JSON.stringify({ runId, dryRun, duplicateGroups, redundantRows, keeperUpdates, processed, errors }, null, 2));
  } catch (error) {
    errors++;
    await failPipelineRun(runId, error);
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
