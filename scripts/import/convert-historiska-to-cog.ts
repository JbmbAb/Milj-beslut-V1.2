import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS } from './config/mimersBrunn';

// We now look for data in the Master Archive
const SOURCE_ROOT = path.join(PATHS.RASTERS, 'LM');
const TEMP_DIR = 'C:\\temp-cog-historical'; // Moved to C: as D: is legacy
const DEST_DIR = path.join(PATHS.RASTERS, 'LM', 'Historiska_COG');

function runGdal(inputTif: string, outputTif: string) {
  console.log(`Converting to COG: ${outputTif}`);
  // Using the full path to gdal_translate for reliability
  const GDAL_TRANSLATE = 'C:\\Program Files\\GDAL\\gdal_translate.exe';
  execSync(`"${GDAL_TRANSLATE}" -of COG -co COMPRESS=DEFLATE -co BIGTIFF=YES "${inputTif}" "${outputTif}"`, {
    stdio: 'inherit',
  });
}

function findFilesRecursive(dir: string, ext: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
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

  console.log(`DONE. Processed: ${zipFile}`);
}

function main() {
  console.log('🚀 HISTORICAL COG CONVERTER (Mimers Brunn)');
  console.log(`Source Root: ${SOURCE_ROOT}`);
  console.log(`Target Dir:  ${DEST_DIR}\n`);

  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }

  // Look for zips in all LM dataset folders
  const zipFiles = findFilesRecursive(SOURCE_ROOT, '.zip');
  for (const zip of zipFiles) {
    processZip(zip);
  }
  
  // Also look for standalone tifs that might have been harvested uncompressed
  const standalones = findFilesRecursive(SOURCE_ROOT, '.tif');
  for (const tif of standalones) {
    // Avoid re-processing files already in the destination
    if (tif.startsWith(DEST_DIR)) continue;
    
    const baseName = path.basename(tif);
    const destFile = path.join(DEST_DIR, baseName);
    if (!fs.existsSync(destFile)) {
      runGdal(tif, destFile);
    }
  }

  console.log('\nAll done!');
}

main();
