import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SOURCE_DIR = 'C:\\Users\\jimmy\\Desktop\\OutlookExport';
const TARGET_DIR = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\extracted';

async function main() {
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
      // Use PowerShell Expand-Archive as it's built-in on Windows 10/11
      const cmd = `powershell -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${subDir.replace(/'/g, "''")}' -Force"`;
      execSync(cmd, { stdio: 'inherit' });
      console.log(`  Done.`);
    } catch (e) {
      console.error(`  Failed to extract ${zipName}:`, e);
    }
  }

  console.log('Extraction complete.');
}

main().catch(console.error);
