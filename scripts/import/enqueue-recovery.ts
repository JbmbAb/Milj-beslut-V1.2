import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING DATABASE RECOVERY ENQUEUE ===');

  // 1. Clear existing incomplete data
  console.log('Step 1: Clearing existing chunks and requirements...');
  const deletedChunks = await prisma.documentChunk.deleteMany({});
  const deletedNodes = await prisma.knowledgeNode.deleteMany({});
  const deletedEdges = await prisma.knowledgeEdge.deleteMany({});
  const deletedReqs = await prisma.requirementRecord.deleteMany({});
  const deletedCitations = await prisma.requirementCitation.deleteMany({});
  const deletedCases = await prisma.requirementCase.deleteMany({});
  
  console.log(`- Deleted ${deletedChunks.count} chunks`);
  console.log(`- Deleted ${deletedNodes.count} nodes`);
  console.log(`- Deleted ${deletedEdges.count} edges`);
  console.log(`- Deleted ${deletedReqs.count} requirements`);
  console.log(`- Deleted ${deletedCitations.count} citations`);
  console.log(`- Deleted ${deletedCases.count} cases`);

  // 2. Reset DocumentRecord statuses
  console.log('\nStep 2: Resetting DocumentRecord statuses...');
  const resetDocs = await prisma.documentRecord.updateMany({
    data: { status: 'METADATA_ONLY' }
  });
  console.log(`- Reset ${resetDocs.count} documents to METADATA_ONLY`);

  // 3. Reset Attachment parsed flag
  console.log('\nStep 3: Resetting attachment parsed flags...');
  await prisma.$executeRawUnsafe('UPDATE attachments SET parsed = FALSE');
  console.log('- Reset all rows in attachments table to parsed=FALSE');

  // 4. Enqueue EXTRACT_TEXT jobs
  console.log('\nStep 4: Enqueueing EXTRACT_TEXT jobs for all documents...');
  const docs = await prisma.documentRecord.findMany({
    select: { id: true, projectId: true }
  });

  let enqueued = 0;
  for (const doc of docs) {
    await prisma.searchJob.create({
      data: {
        type: 'EXTRACT_TEXT',
        projectId: doc.projectId,
        payload: { documentId: doc.id },
        status: 'PENDING'
      }
    });
    enqueued++;
    if (enqueued % 100 === 0) console.log(`  Enqueued ${enqueued}...`);
  }
  console.log(`- Total enqueued: ${enqueued} jobs`);

  console.log('\n=== RECOVERY ENQUEUE COMPLETE ===');
  console.log('Next steps:');
  console.log('1. Run scripts/run-worker.ts to process text extraction');
  console.log('2. Run scripts/import/extract-requirements-idempotent.ts to rebuild matrix');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
