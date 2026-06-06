import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SOURCE_DIR = 'D:\\ingest-arkiv-2026-03-29';
const TEMP_DIR = 'D:\\temp-cog-extract';
const DEST_DIR = 'H:\\Delade enheter\\Miljöbeslut\\GEodata\\Raster\\COG\\NMD';

function runGdal(inputTif: string, outputTif: string) {
  console.log(`Converting to COG: ${outputTif}`);
  // -of COG enables Cloud Optimized GeoTIFF
  // -co COMPRESS=DEFLATE provides good compression
  // -co BIGTIFF=YES handles files > 4GB
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
  if (tifs.length === 0) {
    console.log('No .tif files found in zip, skipping conversion.');
  }

  for (const tif of tifs) {
    const baseName = path.basename(tif);
    const destFile = path.join(DEST_DIR, baseName);
    runGdal(tif, destFile);
  }

  console.log('Cleaning up temp directory...');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log(`Deleting original zip to free space: ${zipFile}`);
  fs.unlinkSync(zipFile);
}

function main() {
  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }

  const zipFiles = findFilesRecursive(SOURCE_DIR, '.zip');
  console.log(`Found ${zipFiles.length} zip files in ${SOURCE_DIR}.`);

  for (const zip of zipFiles) {
    processZip(zip);
  }
  
  // Also process standalone .tif files just in case
  const standalones = findFilesRecursive(SOURCE_DIR, '.tif');
  for (const tif of standalones) {
    console.log(`\n=== Processing standalone TIF: ${tif} ===`);
    const baseName = path.basename(tif);
    const destFile = path.join(DEST_DIR, baseName);
    runGdal(tif, destFile);
    console.log(`Deleting original standalone tif: ${tif}`);
    fs.unlinkSync(tif);
  }

  console.log('\nAll done!');
}

main();
