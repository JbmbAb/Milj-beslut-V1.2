/**
 * Harvest MSB Karteringar from lastkaj.mcf.se → GEO_Master_Archive/Data/MCF/<category>/.
 *
 * Usage:
 *   npx tsx scripts/import/download-lastkaj-rest.ts --pilot
 *   npx tsx scripts/import/download-lastkaj-rest.ts --folder=finkorniga-jordar --only=orsa-2017.zip
 *   npx tsx scripts/import/download-lastkaj-rest.ts --all-stability
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getHarvestPath, MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'https://lastkaj.mcf.se/Karteringar/';

const FLOOD_FOLDERS = [
  'oversvamning-vattendrag',
  'oversvamning-kust',
  'oversvamning-alv',
  'oversvamning-malaren',
] as const;

const STABILITY_FOLDERS = [
  'finkorniga-jordar',
  'oversiktlig-stabilitetskartering-finkorniga-jordarter',
  'moran-grovkorninga-jordar',
  'oversiktlig-stabilitetskartering-i-moran-och-grova-jordar',
] as const;

/** Pilot ZIPs for Librarian path validation (Orsa, Enköping, Göteborg skred). */
const PILOT_DOWNLOADS: Array<{ folder: string; file: string }> = [
  { folder: 'finkorniga-jordar', file: 'orsa-2017.zip' },
  { folder: 'finkorniga-jordar', file: 'Enkoping.zip' },
  { folder: 'finkorniga-jordar', file: 'goteborg-skredriskkartering-2005.zip' },
];

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function resolveFolders(): string[] {
  if (hasFlag('pilot')) {
    return [...new Set(PILOT_DOWNLOADS.map((p) => p.folder))];
  }
  const folder = readArg('folder');
  if (folder) return [folder];
  if (hasFlag('all-stability')) return [...STABILITY_FOLDERS];
  if (hasFlag('all-flood')) return [...FLOOD_FOLDERS];
  if (hasFlag('all')) return [...STABILITY_FOLDERS, ...FLOOD_FOLDERS];
  return [...STABILITY_FOLDERS];
}

function resolveOnlyFilter(): Set<string> | null {
  const only = readArg('only');
  if (only) {
    return new Set(
      only
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  if (hasFlag('pilot')) {
    return new Set(PILOT_DOWNLOADS.map((p) => p.file));
  }
  return null;
}

function pilotFilesForFolder(folder: string): Set<string> | null {
  if (!hasFlag('pilot')) return null;
  return new Set(PILOT_DOWNLOADS.filter((p) => p.folder === folder).map((p) => p.file));
}

async function fetchDirectoryIndex(dirName: string): Promise<string[]> {
  const url = `${BASE_URL}${dirName}/`;
  console.log(`Hämtar index för ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Kunde inte hämta index för ${dirName}: ${response.statusText}`);
  }
  const html = await response.text();

  const linkRegex = /href="([^"]+\.(?:zip|pdf))"/gi;
  const files: string[] = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawLink = match[1];
    if (rawLink.startsWith('http') || rawLink.startsWith('//')) continue;

    try {
      const decoded = decodeURIComponent(rawLink);
      const filename = path.basename(decoded);
      if (filename && !files.includes(filename)) {
        files.push(filename);
      }
    } catch {
      const filename = path.basename(rawLink);
      if (filename && !files.includes(filename)) {
        files.push(filename);
      }
    }
  }
  return files;
}

async function downloadFile(url: string, destPath: string, filename: string, retries = 3): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const sizeHeader = response.headers.get('content-length');
      const sizeMb = sizeHeader ? (parseInt(sizeHeader, 10) / (1024 * 1024)).toFixed(2) : 'okänd';
      console.log(`  Laddar ner ${filename} (${sizeMb} MB) - Försök ${attempt}/${retries}...`);

      const fileStream = fs.createWriteStream(destPath);
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fileStream);
        return;
      }
      throw new Error('Responsens body är null');
    } catch (err) {
      console.error(
        `  [Försök ${attempt}/${retries}] Fel vid nedladdning av ${filename}:`,
        err instanceof Error ? err.message : err,
      );
      if (fs.existsSync(destPath)) {
        try {
          fs.unlinkSync(destPath);
        } catch (unlinkError) {
          console.warn(
            `  Kunde inte rensa ofullständig fil ${destPath}:`,
            unlinkError instanceof Error ? unlinkError.message : unlinkError,
          );
        }
      }
      if (attempt === retries) {
        throw err;
      }
      console.log('  Väntar 5 sekunder innan nästa försök...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

function shouldDownload(filename: string, folder: string, globalOnly: Set<string> | null): boolean {
  const pilotOnly = pilotFilesForFolder(folder);
  if (pilotOnly) return pilotOnly.has(filename);
  if (globalOnly) return globalOnly.has(filename);
  return true;
}

async function main() {
  const folders = resolveFolders();
  const globalOnly = resolveOnlyFilter();

  console.log('==================================================');
  console.log('   Karteringar Harvester (Mimers Brunn)');
  console.log('==================================================');
  console.log(`Kategorier: ${folders.join(', ')}`);
  if (hasFlag('pilot')) {
    console.log(`Pilot: ${PILOT_DOWNLOADS.map((p) => p.file).join(', ')}`);
  }

  const resumeHarvest = readArg('resume-harvest');

  for (const folder of folders) {
    const targetDir = resumeHarvest
      ? path.join(MASTER_ARCHIVE_ROOT, 'Data', 'MCF', folder, resumeHarvest)
      : getHarvestPath('MCF', folder);
    const rawDir = path.join(targetDir, 'raw');

    console.log(`\n=== Processar kategori: ${folder} ===`);
    console.log(`   Target: ${targetDir}`);

    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    let filesToDownload: string[] = [];
    try {
      filesToDownload = await fetchDirectoryIndex(folder);
      filesToDownload = filesToDownload.filter((f) => shouldDownload(f, folder, globalOnly));
      console.log(`Hämtar ${filesToDownload.length} fil(er) för ${folder}.`);
    } catch (err) {
      console.error(`Kunde inte lista filer för ${folder}:`, err);
      continue;
    }

    let downloadedCount = 0;

    for (let i = 0; i < filesToDownload.length; i++) {
      const filename = filesToDownload[i];
      const fileUrl = `${BASE_URL}${folder}/${encodeURIComponent(filename)}`;
      const destPath = path.join(rawDir, filename);
      const progressStr = `[${i + 1}/${filesToDownload.length}]`;

      if (fs.existsSync(destPath)) {
        const localStat = fs.statSync(destPath);
        if (localStat.size > 0) {
          console.log(`  ${progressStr} SKIP: ${filename} (finns redan lokalt)`);
          continue;
        }
      }

      try {
        await downloadFile(fileUrl, destPath, filename);
        downloadedCount++;
      } catch (err) {
        console.error(`  ${progressStr} MISSLYCKADES med ${filename}:`, err);
      }
    }

    if (downloadedCount > 0 || fs.readdirSync(rawDir).length > 0) {
      console.log(`   - Genererar manifest för ${folder}...`);
      await createManifest(rawDir, {
        provider: 'MCF',
        dataset: folder,
        version: new Date().toISOString().split('T')[0],
        source_url: `${BASE_URL}${folder}/`,
        provenance: 'harvested',
      });
    }

    console.log(`Kategori ${folder} klar.`);
  }

  console.log('\n==================================================');
  console.log('            ALLA HÄMTNINGAR KLARA!              ');
  console.log('==================================================');
}

main().catch((err) => {
  console.error('Allvarligt fel under körning:', err);
  process.exit(1);
});
