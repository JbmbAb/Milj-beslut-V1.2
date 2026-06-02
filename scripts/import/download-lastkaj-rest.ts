import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const BASE_URL = 'https://lastkaj.mcf.se/Karteringar/';
const TARGET_DIR = 'D:\\Geo inlärning';

const FOLDERS_TO_DOWNLOAD = [
  'oversvamning-vattendrag',
  'oversvamning-kust',
  'oversvamning-alv',
  'oversvamning-malaren',
  'oversiktlig-stabilitetskartering-i-moran-och-grova-jordar'
];

async function fetchDirectoryIndex(dirName: string): Promise<string[]> {
  const url = `${BASE_URL}${dirName}/`;
  console.log(`Hämtar index för ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Kunde inte hämta index för ${dirName}: ${response.statusText}`);
  }
  const html = await response.text();
  
  // Extrahera länkar från HTML (A-taggar som pekar på .zip eller .pdf)
  const linkRegex = /href="([^"]+\.(?:zip|pdf))"/gi;
  const files: string[] = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawLink = match[1];
    // Ignorera absoluta länkar eller länkar till andra servrar om de finns
    if (rawLink.startsWith('http') || rawLink.startsWith('//')) continue;
    
    // Avkoda URL (t.ex. %C3%B6 -> ö)
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
        await finished(Readable.fromWeb(response.body as any).pipe(fileStream));
        return; // Success!
      } else {
        throw new Error(`Responsens body är null`);
      }
    } catch (err) {
      console.error(`  [Försök ${attempt}/${retries}] Fel vid nedladdning av ${filename}:`, err instanceof Error ? err.message : err);
      // Clean up partially downloaded file to avoid corruption
      if (fs.existsSync(destPath)) {
        try {
          fs.unlinkSync(destPath);
        } catch (unlinkError) {
          console.warn(
            `  Kunde inte rensa ofullstandig fil ${destPath}:`,
            unlinkError instanceof Error ? unlinkError.message : unlinkError,
          );
        }
      }
      if (attempt === retries) {
        throw err;
      }
      console.log(`  Väntar 5 sekunder innan nästa försök...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function deduplicateDir(dirPath: string): Promise<void> {
  console.log(`\n=== Söker efter dubbletter i ${dirPath} ===`);
  if (!fs.existsSync(dirPath)) {
    console.log(`Mappen finns inte: ${dirPath}`);
    return;
  }

  const files = fs.readdirSync(dirPath);
  let removedCount = 0;
  let freedBytes = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    // Leta efter filer som slutar med " (1).zip", " (2).zip", etc.
    const duplicateRegex = /(.+)\s\(\d+\)\.zip$/i;
    const match = file.match(duplicateRegex);

    if (match) {
      const baseName = match[1] + '.zip';
      const basePath = path.join(dirPath, baseName);

      if (fs.existsSync(basePath)) {
        const baseStat = fs.statSync(basePath);
        // Om de har samma storlek, är det en garanterad dubblett!
        if (stat.size === baseStat.size) {
          console.log(`  Raderar dubblett: "${file}" -> matchar originalet "${baseName}" (${(stat.size / (1024*1024)).toFixed(2)} MB)`);
          fs.unlinkSync(filePath);
          removedCount++;
          freedBytes += stat.size;
        } else {
          console.log(`  Hittade fil med dubbletts-namn "${file}" men storleken matchar inte originalet. Raderar inte.`);
        }
      }
    }
  }

  if (removedCount > 0) {
    console.log(`  Klar! Raderade ${removedCount} dubbletter. Frigjorde ${(freedBytes / (1024 * 1024)).toFixed(2)} MB utrymme.`);
  } else {
    console.log(`  Inga namngivna dubbletter (t.ex. "*(1).zip") hittades.`);
  }
}

async function main() {
  console.log('==================================================');
  console.log('   Karteringar Nedladdning & Avdubblettings-verktyg');
  console.log('==================================================');

  // 1. Kör avdubbletting på rotmappen först
  await deduplicateDir(TARGET_DIR);

  // 2. Skapa rotmappen om den inte finns
  if (!fs.existsSync(TARGET_DIR)) {
    console.log(`Skapar målmapp: ${TARGET_DIR}`);
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  // 3. Processa varje underkatalog
  for (const folder of FOLDERS_TO_DOWNLOAD) {
    console.log(`\n=== Processar kategori: ${folder} ===`);
    const subfolderPath = path.join(TARGET_DIR, folder);
    if (!fs.existsSync(subfolderPath)) {
      console.log(`Skapar undermapp: ${subfolderPath}`);
      fs.mkdirSync(subfolderPath, { recursive: true });
    }

    let filesToDownload: string[] = [];
    try {
      filesToDownload = await fetchDirectoryIndex(folder);
      console.log(`Hittade ${filesToDownload.length} filer på servern för ${folder}.`);
    } catch (err) {
      console.error(`Kunde inte lista filer för ${folder}:`, err);
      continue;
    }

    let downloadedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < filesToDownload.length; i++) {
      const filename = filesToDownload[i];
      const fileUrl = `${BASE_URL}${folder}/${encodeURIComponent(filename)}`;
      const destPath = path.join(subfolderPath, filename);

      const progressStr = `[${i + 1}/${filesToDownload.length}]`;

      if (fs.existsSync(destPath)) {
        const localStat = fs.statSync(destPath);
        if (localStat.size > 0) {
          console.log(`  ${progressStr} SKIP: ${filename} (finns redan lokalt)`);
          skippedCount++;
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

    console.log(`Kategori ${folder} klar. Nedladdade: ${downloadedCount}, Skippade: ${skippedCount}`);
  }

  console.log('\n==================================================');
  console.log('            ALLA HÄMTNINGAR OCH RENAS CLEAR!      ');
  console.log('==================================================');
}

main().catch((err) => {
  console.error('Allvarligt fel under körning:', err);
  process.exit(1);
});
