/**
 * Harvest MSB översvämnings-PDF:er från Lastkaj → Documents/Sources/MCF/Oversvamning/.
 *
 * Dessa är metodrapporter (inte vektorer). Vektorer hämtas via harvest-msb-oversvamning-to-master.ts.
 */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import dotenv from 'dotenv';
import { PATHS } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';

dotenv.config();

const BASE_URL = 'https://lastkaj.mcf.se/Karteringar/';

const FLOOD_FOLDERS = [
  { folder: 'oversvamning-alv', domain: 'alv' },
  { folder: 'oversvamning-kust', domain: 'kust' },
  { folder: 'oversvamning-malaren', domain: 'malaren' },
  { folder: 'oversvamning-vattendrag', domain: 'vattendrag' },
] as const;

async function fetchPdfIndex(dirName: string): Promise<string[]> {
  const response = await fetch(`${BASE_URL}${dirName}/`);
  if (!response.ok) {
    throw new Error(`Kunde inte hämta index för ${dirName}: ${response.statusText}`);
  }
  const html = await response.text();
  const linkRegex = /href="([^"]+\.pdf)"/gi;
  const files: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawLink = match[1];
    if (rawLink.startsWith('http') || rawLink.startsWith('//')) continue;
    const filename = path.basename(decodeURIComponent(rawLink));
    if (filename && !files.includes(filename)) files.push(filename);
  }
  return files;
}

async function downloadPdf(url: string, destPath: string, retries = 3): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const fileStream = fs.createWriteStream(destPath);
      if (!response.body) throw new Error('Empty response body');
      await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fileStream);
      return;
    } catch (error) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      if (attempt === retries) throw error;
      console.warn(`  retry ${attempt}/${retries} for ${path.basename(destPath)}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function main(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];

  for (const { folder, domain } of FLOOD_FOLDERS) {
    const targetDir = path.join(PATHS.DOCUMENTS, 'MCF', 'Oversvamning', domain, timestamp);
    fs.mkdirSync(targetDir, { recursive: true });

    const files = await fetchPdfIndex(folder);
    console.log(`\n=== ${folder} (${files.length} PDF) ===`);

    for (const fileName of files) {
      const destPath = path.join(targetDir, fileName);
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        console.log(`  SKIP ${fileName}`);
        continue;
      }
      const fileUrl = `${BASE_URL}${folder}/${encodeURIComponent(fileName)}`;
      console.log(`  → ${fileName}`);
      await downloadPdf(fileUrl, destPath);
    }

    await createManifest(targetDir, {
      provider: 'MCF',
      dataset: `oversvamning_${domain}`,
      version: new Date().toISOString().split('T')[0],
      source_url: `${BASE_URL}${folder}/`,
      provenance: 'harvested_lastkaj_pdf_reports',
    });
  }

  console.log('\n✅ Översvämnings-PDF:er arkiverade under Documents/Sources/MCF/Oversvamning/.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
