import { Firestore } from '@google-cloud/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

/**
 * migrateToFirestore.ts
 * Uploads curated sewage documents to the new Firestore database.
 */

async function runMigration() {
  const projectId = 'miljointelligens';
  const databaseId = 'miljointelligens';
  const collectionId = 'sewage-knowledge';
  const sourceDir = path.join(process.cwd(), 'training/sewage-ai/source-material');

  logger.info(`Starting migration to Firestore: ${projectId}.${databaseId}.${collectionId}`);

  const firestore = new Firestore({
    projectId,
    databaseId,
  });

  const files = fs.readdirSync(sourceDir);
  let count = 0;

  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) continue;

    const fileExt = path.extname(file).toLowerCase();
    const docId = file.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 1500); // Firestore friendly ID

    try {
      // Basic metadata extraction
      const docData = {
        fileName: file,
        extension: fileExt,
        sizeBytes: stats.size,
        uploadedAt: new Date().toISOString(),
        category: file.includes('dom') ? 'LEGAL' : file.includes('boverket') ? 'BUILDING' : 'TECHNICAL',
        // In a real scenario, we would extract text content here
        // For this first step, we index the existence and metadata
        processed: false
      };

      await firestore.collection(collectionId).doc(docId).set(docData);
      count++;
      
      if (count % 20 === 0) {
        logger.info(`Uploaded ${count} document headers...`);
      }
    } catch (err) {
      logger.error(`Failed to upload ${file}:`, err);
    }
  }

  logger.info(`Migration complete! Total documents indexed: ${count}`);
}

runMigration().catch(err => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
