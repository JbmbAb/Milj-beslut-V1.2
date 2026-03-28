import { PrismaClient, DocumentProcessingStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * This script corrects the status of DocumentRecords that are marked as EMBEDDED
 * but are missing their corresponding DocumentContent, which is an inconsistent state.
 *
 * By default, it runs in "dry run" mode. To apply changes, run with the --live flag.
 * Example: tsx scripts/fix-document-status-drift.ts --live
 */
async function main() {
  const isLiveRun = process.argv.includes('--live');
  console.log(`Running in ${isLiveRun ? 'LIVE' : 'DRY RUN'} mode.`);

  const embeddedDocs = await prisma.documentRecord.findMany({
    where: { status: DocumentProcessingStatus.EMBEDDED },
    select: { id: true, originalName: true },
  });

  if (embeddedDocs.length === 0) {
    console.log('No documents with status EMBEDDED found. Nothing to do.');
    return;
  }

  console.log(`Found ${embeddedDocs.length} documents with status EMBEDDED. Verifying content...`);

  const idsToFix: string[] = [];

  for (const doc of embeddedDocs) {
    const contentCount = await prisma.documentContent.count({
      where: { documentId: doc.id },
    });
    if (contentCount === 0) {
      idsToFix.push(doc.id);
    }
  }

  if (idsToFix.length > 0) {
    console.log(`\nFound ${idsToFix.length} documents with EMBEDDED status but no DocumentContent.`);
    if (isLiveRun) {
      console.log('LIVE RUN: Updating documents to METADATA_ONLY...');
      const updateResult = await prisma.documentRecord.updateMany({
        where: { id: { in: idsToFix } },
        data: { status: DocumentProcessingStatus.METADATA_ONLY },
      });
      console.log(`Successfully updated ${updateResult.count} documents.`);
    } else {
      console.log('DRY RUN: Would have updated the status for the document IDs listed above.');
    }
  } else {
    console.log('\nAll EMBEDDED documents have corresponding content. No inconsistencies found.');
  }
}

main()
  .catch((e) => {
    console.error('An error occurred:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
