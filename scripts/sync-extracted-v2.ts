import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const prisma = new PrismaClient();
const EXTRACTED_DIR = 'C:/Users/jimmy/Desktop/OutlookExport/extracted';
const PROJECT_ID = 'cmmpmyhc90004cuyg57iuzcmo';
const ORG_ID = 'cmmpmyhbi0000cuygxder83pd';

async function main() {
  console.log('--- ROBUST RECURSIVE SYNC OF EXTRACTED DOCUMENTS ---');
  
  function getFilesRecursively(dir: string): string[] {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getFilesRecursively(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.docx'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }

  let files: string[] = [];
  try {
    files = getFilesRecursively(EXTRACTED_DIR);
  } catch (err) {
    console.error('Failed to scan directory:', err);
    return;
  }

  console.log(`Found ${files.length} candidate files in ${EXTRACTED_DIR}`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    try {
      const filename = path.basename(filePath);
      // Create a deterministic disk name to avoid duplicates if re-running
      // Use full path (normalized) to ensure uniqueness across different folders
      const normalizedPath = filePath.replace(/\\\\/g, '/').toLowerCase();
      const pathHash = crypto.createHash('md5').update(normalizedPath).digest('hex');
      const diskName = `EXTRACTED_${pathHash}_${filename}`;
      
      const existing = await prisma.documentRecord.findUnique({
        where: { diskName }
      });

      if (existing) {
        skipped++;
        continue;
      }

      const stat = fs.statSync(filePath);
      
      await prisma.documentRecord.create({
        data: {
          projectId: PROJECT_ID,
          organisationId: ORG_ID,
          entryId: diskName,
          subject: `Extraherat ur ZIP: ${filename}`,
          originalName: filename,
          diskName: diskName,
          absolutePath: filePath,
          fileSize: BigInt(stat.size),
          status: 'METADATA_ONLY'
        }
      });

      // Enqueue OCR job
      await prisma.searchJob.create({
        data: {
          type: 'EXTRACT_TEXT',
          projectId: PROJECT_ID,
          payload: { documentId: diskName, isExtracted: true },
          status: 'PENDING'
        }
      });

      synced++;
      if (synced % 50 === 0) console.log(`  Synced ${synced}...`);
    } catch (err) {
      console.error(`Error syncing ${filePath}:`, err);
      errors++;
    }
  }

  console.log('--- SYNC COMPLETE ---');
  console.log(`Total Found: ${files.length}`);
  console.log(`Synced Now:  ${synced}`);
  console.log(`Skipped:     ${skipped}`);
  console.log(`Errors:      ${errors}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
