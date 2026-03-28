import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const prisma = new PrismaClient();
const EXTRACTED_DIR = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\extracted';
const PROJECT_ID = 'cmmpmyhc90004cuyg57iuzcmo';
const ORG_ID = 'cmmpmyhbi0000cuygxder83pd';

async function main() {
  console.log('--- RECURSIVE SYNC OF EXTRACTED DOCUMENTS ---');
  
  const scanFolder = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      file = path.join(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(scanFolder(file));
      } else {
        const ext = path.extname(file).toLowerCase();
        if (['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.docx'].includes(ext)) {
          results.push(file);
        }
      }
    });
    return results;
  };

  const files = scanFolder(EXTRACTED_DIR);
  console.log(`Found ${files.length} candidate files in extracted/ folder.`);

  let synced = 0;
  let skipped = 0;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const diskName = `EXTRACTED_${crypto.createHash('md5').update(filePath).digest('hex')}_${filename}`;
    
    // Check if exists
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
        subject: `Extracted from ZIP: ${filename}`,
        originalName: filename,
        diskName: diskName,
        absolutePath: filePath,
        fileSize: BigInt(stat.size),
        status: 'METADATA_ONLY'
      }
    });

    // Enqueue job
    await prisma.searchJob.create({
      data: {
        type: 'EXTRACT_TEXT',
        projectId: PROJECT_ID,
        payload: { documentId: diskName, isExtracted: true },
        status: 'PENDING'
      }
    });

    synced++;
    if (synced % 100 === 0) console.log(`  Synced ${synced}...`);
  }

  console.log(`Synced: ${synced}`);
  console.log(`Skipped (already exists): ${skipped}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
