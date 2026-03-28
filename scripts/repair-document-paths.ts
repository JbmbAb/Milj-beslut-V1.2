import { PrismaClient, DocumentProcessingStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const EXPORT_DIR = 'C:\\Users\\jimmy\\Desktop\\OutlookExport';

async function main() {
  console.log('--- REPAIRING DOCUMENT PATHS ---');
  
  const documents = await prisma.documentRecord.findMany();
  console.log(`Found ${documents.length} documents in database.`);

  let repairedCount = 0;
  let missingCount = 0;

  for (const doc of documents) {
    const filename = path.basename(doc.absolutePath);
    // Check if filenames in EXPORT_DIR have some prefix or similar
    // Based on manifest.csv, many have message_id prefix like 00000000125C043_...
    
    let targetPath = path.join(EXPORT_DIR, filename);
    
    // Check if file exists
    if (!fs.existsSync(targetPath)) {
      // Try with another approach - find file in EXPORT_DIR that ends with filename
      const files = fs.readdirSync(EXPORT_DIR);
      const matched = files.find(f => f.endsWith(filename));
      if (matched) {
        targetPath = path.join(EXPORT_DIR, matched);
      }
    }

    if (fs.existsSync(targetPath)) {
      await prisma.documentRecord.update({
        where: { id: doc.id },
        data: {
          absolutePath: targetPath,
          status: DocumentProcessingStatus.METADATA_ONLY,
        }
      });
      repairedCount++;
    } else {
      missingCount++;
    }
  }

  console.log(`Repaired: ${repairedCount}`);
  console.log(`Still Missing on Disk: ${missingCount}`);

  console.log('Clearing old chunks and content...');
  await prisma.documentChunk.deleteMany({});
  await prisma.documentContent.deleteMany({});
  await prisma.requirementRecord.deleteMany({});
  await prisma.requirementCitation.deleteMany({});
  
  // Re-enqueue jobs? Or just let the extractor find them.
  // The searchJobs might still be 'DONE'.
  console.log('Resetting search jobs...');
  await prisma.searchJob.deleteMany({});

  console.log('Done.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
