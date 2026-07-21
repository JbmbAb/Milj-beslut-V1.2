import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { extractCorpusContent } from '../server/modules/legal/services/legalCorpusTextExtractor';
import crypto from 'node:crypto';
import { PATHS } from './import/config/mimersBrunn';

const prisma = new PrismaClient();

async function walk(dir: string): Promise<string[]> {
  let files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(await walk(fullPath));
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading ${dir}:`, err);
  }
  return files;
}

function toKey(...parts: string[]): string {
  return parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join(':')
    .replace(/:+/, ':')
    .substring(0, 150);
}

async function main() {
  const rootDir = process.argv.includes('--root-dir') 
    ? process.argv[process.argv.indexOf('--root-dir') + 1] 
    : PATHS.DOCUMENTS;

  console.log(`Skannar ${rootDir} efter PDF-filer...`);
  const pdfs = await walk(rootDir);
  console.log(`Hittade ${pdfs.length} PDF-filer.`);

  let processed = 0;
  let errors = 0;

  for (const pdfPath of pdfs) {
    const relPath = path.relative(rootDir, pdfPath).replace(/\\/g, '/');
    const fileName = path.basename(pdfPath);
    const folderName = path.basename(path.dirname(pdfPath));
    const recordKey = toKey('raw-pdf', relPath);

    // Hoppa över redan importerade för att spara tid
    const existing = await prisma.legalCorpusRecord.findUnique({ where: { recordKey } });
    if (existing && existing.documentText && existing.documentText.length > 50) {
      processed++;
      if (processed % 100 === 0) console.log(`[${processed}/${pdfs.length}] Skippar befintlig: ${fileName}`);
      continue;
    }

    try {
      console.log(`[${processed + 1}/${pdfs.length}] Importerar: ${relPath}`);
      
      const stats = await fs.stat(pdfPath);
      const fileBuffer = await fs.readFile(pdfPath);
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Extrahera text (detta kan ta någon sekund per fil)
      const extraction = await extractCorpusContent(pdfPath, 'application/pdf');

      await prisma.legalCorpusRecord.upsert({
        where: { recordKey },
        create: {
          recordKey,
          canonicalKey: recordKey,
          sourceFamily: 'LOCAL_ARCHIVE',
          sourceSystem: 'FILE_SYSTEM',
          sourceType: 'PDF_DOCUMENT',
          title: fileName,
          summary: `Importerad från mapp: ${folderName}`,
          authorityName: folderName.includes('kommun') ? 'Kommun' : 'Myndighet',
          authorityType: 'Lokalt arkiv',
          legalArea: 'Miljö',
          mimeType: 'application/pdf',
          formatHint: 'pdf',
          sourcePath: pdfPath, // Spara absolut sökväg så UI kan ladda den
          documentText: extraction.documentText,
          searchText: extraction.documentText?.substring(0, 5000) || fileName,
          byteSize: stats.size,
          contentHash,
          language: 'sv',
          metadata: { originalFolder: folderName, isRawPdf: true },
          tags: ['local-archive', 'pdf', folderName.toLowerCase()],
        },
        update: {
          documentText: extraction.documentText,
          searchText: extraction.documentText?.substring(0, 5000) || fileName,
          byteSize: stats.size,
          contentHash,
          sourcePath: pdfPath,
        }
      });
      
      processed++;
    } catch (err: any) {
      console.error(`Fel vid import av ${fileName}:`, err.message);
      errors++;
    }
  }

  console.log(`\nFärdig! Importerade/Uppdaterade ${processed} filer. Fel: ${errors}`);
  await prisma.$disconnect();
}

main().catch(console.error);
