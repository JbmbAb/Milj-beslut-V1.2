import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [docs, content, chunks, attachmentsWithText, attachmentsMissing, metaOnly, kgNodes, kgEdges, statuses] =
    await Promise.all([
      prisma.documentRecord.count(),
      prisma.documentContent.count(),
      prisma.documentChunk.count(),
      prisma.outlookAttachment.count({ where: { extractedText: { not: null } } }),
      prisma.outlookAttachment.count({ where: { OR: [{ extractedText: null }, { extractedText: '' }] } }),
      prisma.documentRecord.count({ where: { status: 'METADATA_ONLY' } }),
      prisma.knowledgeNode.count(),
      prisma.knowledgeEdge.count(),
      prisma.documentRecord.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

  console.log(
    JSON.stringify(
      {
        documents: docs,
        documentContent: content,
        documentChunks: chunks,
        attachmentsWithExtractedText: attachmentsWithText,
        attachmentsMissingExtractedText: attachmentsMissing,
        metadataOnlyDocuments: metaOnly,
        knowledgeNodes: kgNodes,
        knowledgeEdges: kgEdges,
        documentStatuses: statuses,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
