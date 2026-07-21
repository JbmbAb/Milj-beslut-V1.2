/**
 * Synka Outlook-manifest → DocumentRecord → textextraktion → attachment.extracted_text.
 *
 * Kör:
 *   npx tsx scripts/backfill/run-outlook-ingest-pipeline.ts
 *   npx tsx scripts/backfill/run-outlook-ingest-pipeline.ts --limit=50
 *   npx tsx scripts/backfill/run-outlook-ingest-pipeline.ts --all --embed
 */
import { ensureAdminConsoleUser } from '../../server/repositories/userRepository';
import { createOrGetAdminProject } from '../../server/modules/search/adapters/searchRepository';
import { syncManifestMetadata } from '../../server/services/searchService';
import { processSearchJobsOnce } from '../../server/services/searchWorker';
import { PrismaClient } from '@prisma/client';
import { extractDocumentTextAndChunk, embedDocumentChunks } from '../../server/services/searchService';

const prisma = new PrismaClient();

const OUTLOOK_BASE_DIR = process.env.OUTLOOK_BASE_DIR || 'D:\\Users\\jimmy\\Desktop\\OutlookExport';
const OUTLOOK_MANIFEST_PATH =
  process.env.OUTLOOK_MANIFEST_PATH || `${OUTLOOK_BASE_DIR}\\manifest.csv`;

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
  const embed = flag('embed');
  const extractLimit = all ? 10_000 : Math.max(1, Number(arg('limit') || 100));

  console.error(`Outlook pipeline`);
  console.error(`  base: ${OUTLOOK_BASE_DIR}`);
  console.error(`  manifest: ${OUTLOOK_MANIFEST_PATH}`);
  console.error(`  extractLimit: ${extractLimit}, embed: ${embed}`);

  const admin = await ensureAdminConsoleUser(process.env.ADMIN_CONSOLE_USERNAME || 'admin');
  const { project } = await createOrGetAdminProject({
    organisationId: admin.organisationId,
    userId: admin.id,
    propertyDesignation: 'OUTLOOK-INDEX',
  });

  const sync = await syncManifestMetadata({
    projectId: project.id,
    organisationId: admin.organisationId,
    manifestPath: OUTLOOK_MANIFEST_PATH,
    outlookBaseDir: OUTLOOK_BASE_DIR,
  });
  console.error(`Manifest sync: ${JSON.stringify(sync)}`);

  let queuedProcessed = 0;
  for (let i = 0; i < 50; i += 1) {
    const n = await processSearchJobsOnce(5);
    queuedProcessed += n;
    if (n === 0) break;
  }
  console.error(`Search worker drained ${queuedProcessed} queued jobs`);

  const pending = await prisma.documentRecord.findMany({
    where: {
      OR: [{ status: 'METADATA_ONLY' }, { content: { is: null } }, { chunks: { none: {} } }],
    },
    select: { id: true, originalName: true, absolutePath: true },
    take: extractLimit,
    orderBy: { createdAt: 'asc' },
  });

  let extracted = 0;
  let embedded = 0;
  let attachmentsSynced = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of pending) {
    try {
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
        if (embedResult.embeddedChunks > 0) embedded += 1;
      }
      extracted += 1;
      console.error(`OK ${doc.id} (${doc.originalName}) → ${result.chunks} chunks`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('hittades inte')) {
        skipped += 1;
        await prisma.documentRecord.update({ where: { id: doc.id }, data: { status: 'FAILED' } });
        console.error(`SKIP ${doc.id}: ${msg.slice(0, 100)}`);
      } else {
        errors += 1;
        console.error(`ERROR ${doc.id}: ${msg.slice(0, 120)}`);
      }
    }
  }

  const [documents, documentContent, documentChunks, attachmentsWithText, knowledgeNodes] = await Promise.all([
    prisma.documentRecord.count(),
    prisma.documentContent.count(),
    prisma.documentChunk.count(),
    prisma.outlookAttachment.count({ where: { extractedText: { not: null } } }),
    prisma.knowledgeNode.count(),
  ]);

  console.log(
    JSON.stringify(
      {
        projectId: project.id,
        organisationId: admin.organisationId,
        sync,
        queuedProcessed,
        extracted,
        embedded,
        attachmentsSynced,
        skipped,
        errors,
        totals: {
          documents,
          documentContent,
          documentChunks,
          attachmentsWithExtractedText: attachmentsWithText,
          knowledgeNodes,
        },
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
