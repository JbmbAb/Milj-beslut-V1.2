import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

function walk(dir: string): string[] {
  let files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(walk(fullPath));
      } else {
        const ext = entry.name.toLowerCase();
        if (ext.endsWith('.docx') || ext.endsWith('.xlsx') || ext.endsWith('.xlsm') || ext.endsWith('.csv')) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${dir}:`, err);
  }
  return files;
}

function extractOfficeText(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv') {
    try {
      const buffer = fs.readFileSync(filePath);
      return buffer.toString('utf8');
    } catch (err) {
      console.error(`Failed to read CSV ${filePath}:`, err);
      return '';
    }
  }

  const escapedPath = filePath.replace(/'/g, "''");
  let entryName = '';
  if (extension === '.docx') {
    entryName = 'word/document.xml';
  } else if (extension === '.xlsx' || extension === '.xlsm') {
    entryName = 'xl/sharedStrings.xml';
  } else {
    return '';
  }

  // PowerShell script to read XML inside the zip package and strip HTML/XML tags
  const psCommand = `
    $ErrorActionPreference = 'Stop';
    try {
      $archive = [System.IO.Compression.ZipFile]::OpenRead('${escapedPath}');
      $entry = $archive.Entries | Where-Object { $_.FullName -eq '${entryName}' };
      if ($entry) {
        $stream = $entry.Open();
        $reader = New-Object System.IO.StreamReader($stream);
        $xml = $reader.ReadToEnd();
        $reader.Close();
        $stream.Close();
        $text = $xml -replace '<[^>]+>', ' ';
        $text = $text -replace '\\s+', ' ';
        Write-Output $text;
      } else {
        Write-Output '';
      }
      $archive.Dispose();
    } catch {
      Write-Output '';
    }
  `;

  try {
    const cleanCommand = psCommand.replace(/\r?\n/g, ' ');
    const output = execSync(`powershell -NoProfile -Command "${cleanCommand}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return output.trim();
  } catch (err) {
    console.warn(`Failed to extract text from ${filePath} using PowerShell.`);
    return '';
  }
}

function toKey(...parts: string[]): string {
  return parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join(':')
    .replace(/:+/, ':')
    .substring(0, 150);
}

async function main() {
  const rootDir = 'D:\\GEodata\\Geo_inlarning_Office';
  console.log(`Skannar ${rootDir} efter Office-filer...`);
  const files = walk(rootDir);
  console.log(`Hittade ${files.length} Office-filer.`);

  let processed = 0;
  let errors = 0;

  for (const filePath of files) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const fileName = path.basename(filePath);
    const folderName = 'Geo_inlarning_Office';
    const recordKey = toKey('raw-office', relPath);

    try {
      console.log(`[${processed + 1}/${files.length}] Importerar: ${relPath}`);
      
      const stats = fs.statSync(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Extrahera text (detta kör powershell)
      const textContent = extractOfficeText(filePath);
      const extension = path.extname(filePath).toLowerCase().replace(/^\./, '');

      let mimeType = 'application/octet-stream';
      if (extension === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (extension === 'xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (extension === 'xlsm') mimeType = 'application/vnd.ms-excel.sheet.macroEnabled.12';
      else if (extension === 'csv') mimeType = 'text/csv';

      await prisma.legalCorpusRecord.upsert({
        where: { recordKey },
        create: {
          recordKey,
          canonicalKey: recordKey,
          sourceFamily: 'LOCAL_ARCHIVE',
          sourceSystem: 'FILE_SYSTEM',
          sourceType: 'OFFICE_DOCUMENT',
          title: fileName,
          summary: `Importerad Office-fil från Geo inlärning: ${fileName}`,
          authorityName: 'Lokalt arkiv',
          authorityType: 'Dokument',
          legalArea: 'Miljö',
          mimeType,
          formatHint: extension,
          sourcePath: filePath,
          documentText: textContent || `Binary Office File: ${fileName}`,
          searchText: textContent?.substring(0, 5000) || fileName,
          byteSize: stats.size,
          contentHash,
          language: 'sv',
          metadata: { originalFolder: folderName, isRawOffice: true },
          tags: ['local-archive', extension, 'office'],
        },
        update: {
          documentText: textContent || `Binary Office File: ${fileName}`,
          searchText: textContent?.substring(0, 5000) || fileName,
          byteSize: stats.size,
          contentHash,
          sourcePath: filePath,
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
