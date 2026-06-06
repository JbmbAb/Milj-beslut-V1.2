import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SOURCE_DIR = 'D:\\GEodata\\Lantmateriet_Historiska';
const TEMP_DIR = 'D:\\temp-cog-historical';
const DEST_DIR = 'H:\\Delade enheter\\Miljöbeslut\\GEodata\\Raster\\COG\\Historiska';

function runGdal(inputTif: string, outputTif: string) {
  console.log(`Converting to COG: ${outputTif}`);
  execSync(`"C:\\Program Files\\GDAL\\gdal_translate.exe" -of COG -co COMPRESS=DEFLATE -co BIGTIFF=YES "${inputTif}" "${outputTif}"`, {
    stdio: 'inherit',
  });
}

function findFilesRecursive(dir: string, ext: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFilesRecursive(fullPath, ext));
    } else if (file.toLowerCase().endsWith(ext.toLowerCase())) {
      results.push(fullPath);
    }
  });
  return results;
}

function processZip(zipFile: string) {
  console.log(`\n=== Processing ${zipFile} ===`);
  
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log('Extracting...');
  execSync(`tar -xf "${zipFile}" -C "${TEMP_DIR}"`, { stdio: 'inherit' });

  const tifs = findFilesRecursive(TEMP_DIR, '.tif');
  for (const tif of tifs) {
    const baseName = path.basename(tif);
    const destFile = path.join(DEST_DIR, baseName);
    if (!fs.existsSync(destFile)) {
      runGdal(tif, destFile);
    } else {
      console.log(`Skipping existing: ${destFile}`);
    }
  }

  console.log('Cleaning up temp directory...');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  // BEHÅLLER ORIGINALFILER PÅ D: TILLS DE ÄR DUBBELKOLLADE!
  console.log(`DONE. Keeping original zip on disk: ${zipFile}`);
}

function main() {
  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }

  const zipFiles = findFilesRecursive(SOURCE_DIR, '.zip');
  for (const zip of zipFiles) {
    processZip(zip);
  }
  
  const standalones = findFilesRecursive(SOURCE_DIR, '.tif');
  for (const tif of standalones) {
    const baseName = path.basename(tif);
    const destFile = path.join(DEST_DIR, baseName);
    if (!fs.existsSync(destFile)) {
      runGdal(tif, destFile);
    }
  }

  console.log('\nAll done!');
}

main();
