/**
 * Re-queue and process text extraction for documents missing DocumentContent,
 * then sync attachments.extracted_text from DocumentContent.searchText.
 *
 * Kör:
 *   npx tsx scripts/backfill/reindex-search-and-attachments.ts [--limit=100] [--dry-run]
 *   npx tsx scripts/backfill/reindex-search-and-attachments.ts --all --embed
 */
import { PrismaClient } from '@prisma/client';
import { extractDocumentTextAndChunk, embedDocumentChunks } from '../../server/services/searchService';
import { enqueueSearchJob } from '../../server/modules/search/adapters/searchRepository';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const entry = process.argv.find((v) => v.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3).trim() : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function syncAttachmentExtractedText(documentId: string, searchText: string): Promise<number> {
  const result = await prisma.outlookAttachment.updateMany({
    where: {
      documentId,
      OR: [{ extractedText: null }, { extractedText: '' }],
    },
    data: {
      extractedText: searchText.slice(0, 500_000),
      parsed: true,
      parseFailureReason: null,
    },
  });
  return result.count;
}

async function main() {
  const all = flag('all');
  const dryRun = flag('dry-run');
  const embed = flag('embed');
  const limit = all ? 10_000 : Math.max(1, Number(arg('limit') || 50));

  const docs = await prisma.documentRecord.findMany({
    where: {
      OR: [
        { status: 'METADATA_ONLY' },
        { content: { is: null } },
        { chunks: { none: {} } },
      ],
    },
    select: {
      id: true,
      projectId: true,
      absolutePath: true,
      originalName: true,
      status: true,
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });

  console.error(`Found ${docs.length} documents needing reindex (limit=${limit}, dryRun=${dryRun}, embed=${embed})`);

  let extracted = 0;
  let embedded = 0;
  let attachmentsSynced = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of docs) {
    if (!doc.absolutePath) {
      console.error(`SKIP (no path): ${doc.id}`);
      skipped++;
      continue;
    }

    try {
      if (!dryRun) {
        if (!all) {
          await enqueueSearchJob({
            type: 'EXTRACT_TEXT',
            projectId: doc.projectId,
            payload: { documentId: doc.id },
          });
        }

        const result = await extractDocumentTextAndChunk(doc.id);
        const content = await prisma.documentContent.findUnique({
          where: { documentId: doc.id },
          select: { searchText: true },
        });
        if (content?.searchText) {
          attachmentsSynced += await syncAttachmentExtractedText(doc.id, content.searchText);
        }

        if (embed) {
          const embedResult = await embedDocumentChunks(doc.id);
          embedded += embedResult.embeddedChunks > 0 ? 1 : 0;
        }

        console.error(`OK: ${doc.id} → ${result.chunks} chunks`);
      } else {
        console.error(`DRY-RUN: would extract ${doc.originalName || doc.id}`);
      }
      extracted++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('hittades inte')) {
        console.error(`SKIP (no file): ${doc.id} - ${msg.slice(0, 80)}`);
        skipped++;
        if (!dryRun) {
          await prisma.documentRecord.update({
            where: { id: doc.id },
            data: { status: 'FAILED' },
          });
        }
      } else {
        console.error(`ERROR: ${doc.id}: ${msg.slice(0, 120)}`);
        errors++;
      }
    }
  }

  const [contentCount, chunkCount, attachmentTextCount] = await Promise.all([
    prisma.documentContent.count(),
    prisma.documentChunk.count(),
    prisma.outlookAttachment.count({ where: { extractedText: { not: null } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        candidates: docs.length,
        extracted,
        embedded,
        attachmentsSynced,
        skipped,
        errors,
        totals: {
          documentContent: contentCount,
          documentChunks: chunkCount,
          attachmentsWithExtractedText: attachmentTextCount,
        },
        dryRun,
        embed,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
