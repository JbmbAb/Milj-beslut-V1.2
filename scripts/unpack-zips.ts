import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
type AdmZipConstructor = new (path: string) => { extractAllTo: (targetPath: string, overwrite?: boolean) => void };

function loadAdmZip(): AdmZipConstructor {
  try {
    return require('adm-zip') as AdmZipConstructor;
  } catch {
    throw new Error("Optional dependency 'adm-zip' is not installed. Install it before running unpack-zips.ts.");
  }
}

const SOURCE_DIR = 'C:\\Users\\jimmy\\Desktop\\OutlookExport';
const TARGET_DIR = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\extracted';

async function main() {
  const AdmZip = loadAdmZip();

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  const files = fs.readdirSync(SOURCE_DIR);
  const zips = files.filter(f => f.toLowerCase().endsWith('.zip'));

  console.log(`Found ${zips.length} ZIP files.`);

  for (const zipName of zips) {
    const zipPath = path.join(SOURCE_DIR, zipName);
    const subDir = path.join(TARGET_DIR, zipName.replace('.zip', ''));
    
    if (fs.existsSync(subDir)) {
      console.log(`Skipping already extracted: ${zipName}`);
      continue;
    }

    console.log(`Extracting: ${zipName} -> ${subDir}`);
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(subDir, true);
      console.log(`  Done.`);
    } catch (e) {
      console.error(`  Failed to extract ${zipName}:`, e);
    }
  }

  console.log('Extraction complete.');
}

main().catch(console.error);
