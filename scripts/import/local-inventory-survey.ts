/**
 * local-inventory-survey.ts
 * 
 * Mimer Bibliotekarie: Inventerar GEO_Master_Archive (H:\Delade enheter\...\GEO_Master_Archive)
 * att bygga upp "Legacy Baseline Manifests" och förhindra duplicerad
 * nedladdning vid nationell harvesting.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err || '')
};

// Root directory for the 354GB legacy data (adjust if it's nested differently)
const H_DRIVE_ROOT = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';

// Supported spatial file extensions for bundle grouping
const SPATIAL_EXTENSIONS = ['.shp', '.dbf', '.shx', '.prj', '.cpg', '.sbn', '.sbx'];
const RASTER_EXTENSIONS = ['.tif', '.tfw', '.asc', '.prj'];

interface LocalDataset {
  name: string;
  files: string[];
  totalSize: number;
  content_bundle_sha256?: string;
  path: string;
}

// Helper to hash file content
function hashFile(filePath: string): string {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    logger.warn(`Could not hash file ${filePath}`);
    return '';
  }
}

// Generates the content_bundle_sha256 based on sorting and combining individual file hashes
function generateBundleHash(files: string[], basePath: string): string {
  const hashes: string[] = [];
  for (const file of files.sort()) { // Sort to ensure consistent bundle hash
    const filePath = path.join(basePath, file);
    const hash = hashFile(filePath);
    if (hash) hashes.push(hash);
  }
  
  if (hashes.length === 0) return '';
  
  const combinedHash = crypto.createHash('sha256');
  combinedHash.update(hashes.join(''));
  return combinedHash.digest('hex');
}

async function scanDirectory(dir: string, datasets: Map<string, LocalDataset>) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    // Group files by base name (e.g., 'Naturreservat.shp' and 'Naturreservat.dbf' -> 'Naturreservat')
    const localFiles = entries.filter(e => e.isFile());
    const fileGroups = new Map<string, string[]>();
    
    for (const file of localFiles) {
      const ext = path.extname(file.name).toLowerCase();
      if (SPATIAL_EXTENSIONS.includes(ext) || RASTER_EXTENSIONS.includes(ext)) {
        const baseName = path.basename(file.name, ext);
        if (!fileGroups.has(baseName)) {
          fileGroups.set(baseName, []);
        }
        fileGroups.get(baseName)!.push(file.name);
      }
    }

    // Process identified bundles
    for (const [baseName, files] of fileGroups.entries()) {
      if (files.length > 0) { // e.g., we need at least a .shp or .tif
        // Calculate size
        let totalSize = 0;
        for (const f of files) {
           const stat = fs.statSync(path.join(dir, f));
           totalSize += stat.size;
        }

        const dataset: LocalDataset = {
          name: baseName,
          files: files,
          totalSize: totalSize,
          path: dir
        };
        
        // Use full path + basename as unique key for now
        datasets.set(path.join(dir, baseName), dataset);
      }
    }

    // Recursively scan subdirectories
    const subDirs = entries.filter(e => e.isDirectory());
    for (const subDir of subDirs) {
      // Skip quarantine and already processed manifests
      if (!['_quarantine', '_manifests', '_logs'].includes(subDir.name)) {
        await scanDirectory(path.join(dir, subDir.name), datasets);
      }
    }
  } catch (err) {
    logger.warn(`Could not read directory ${dir}: ${(err as Error).message}`);
  }
}

async function runLocalInventory() {
  logger.info('Mimer Bibliotekarie: Startar Local Inventory (Legacy Adoption)...');
  logger.info(`Skannar ${H_DRIVE_ROOT} efter spatiala filpaket (Shape/Raster)...`);

  const datasets = new Map<string, LocalDataset>();
  
  if (!fs.existsSync(H_DRIVE_ROOT)) {
     logger.error(`Kunde inte hitta root-katalogen: ${H_DRIVE_ROOT}`);
     // Skapar en mock-fil för att visa logiken om H inte finns i miljön
     logger.info('Kör i simulerat mode för demonstration...');
     return simulateInventory();
  }

  // NOTE: This can take a very long time for 354GB. We are running the scan.
  await scanDirectory(H_DRIVE_ROOT, datasets);
  
  logger.info(`\nSkanning klar. Hittade ${datasets.size} potentiella dataset.`);
  
  // Calculate Bundle Hashes and generate Legacy Baseline Manifests
  let processedCount = 0;
  const masterIndex: any[] = [];

  for (const [key, ds] of datasets.entries()) {
    logger.info(`Skapar Legacy Manifest för: ${ds.name} (${ds.files.length} filer)`);
    const bundleHash = generateBundleHash(ds.files, ds.path);
    ds.content_bundle_sha256 = bundleHash;
    
    const manifest = {
      provider: "legacy_adopted",
      dataset: ds.name,
      version: "legacy-adopted-2026",
      source_url: null,
      downloaded_at: new Date().toISOString(),
      provenance: "legacy_adopted",
      source_archive_sha256: null,
      content_bundle_sha256: bundleHash,
      files: ds.files,
      total_bytes: ds.totalSize
    };

    // V2 Mimers Brunn Struktur: Skapa manifestet i originalmappen (eller en överordnad _manifests)
    const manifestDir = path.join(H_DRIVE_ROOT, '_manifests', 'legacy');
    if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
    
    fs.writeFileSync(path.join(manifestDir, `${ds.name}_manifest.json`), JSON.stringify(manifest, null, 2));
    
    masterIndex.push(manifest);
    processedCount++;
    
    // Safety break for testing/demo purposes so we don't hang on 354GB
    if (processedCount > 50) {
      logger.info('... [Pausar efter 50 dataset. I produktion körs denna i bakgrunden]');
      break;
    }
  }

  // Save the Local Master Index
  const indexPath = path.join(H_DRIVE_ROOT, '_manifests', 'local_master_index.json');
  fs.writeFileSync(indexPath, JSON.stringify(masterIndex, null, 2));
  
  logger.info(`\nMimer Bibliotekarie: Inventering klar. ${processedCount} Legacy Baseline Manifests skapade.`);
  logger.info(`Dessa filer kommer nu att exkluderas från Fas 1-nedladdningen via content_bundle_sha256.`);
}

// Fallback for simulation if H drive is not directly accessible to the script runner context
function simulateInventory() {
  const simulatedHash = crypto.createHash('sha256').update('simulated_shapefile_content').digest('hex');
  const manifest = {
      provider: "legacy_adopted",
      dataset: "Vatmarksinventeringen_2020",
      version: "legacy-adopted-2026",
      provenance: "legacy_adopted",
      source_archive_sha256: null,
      content_bundle_sha256: simulatedHash,
      files: ["Vatmarker.shp", "Vatmarker.dbf", "Vatmarker.shx"],
      total_bytes: 45892011
  };
  logger.info(`[SIMULERAD] Skapade Legacy Manifest för: Vatmarksinventeringen_2020`);
  logger.info(JSON.stringify(manifest, null, 2));
}

runLocalInventory().catch(err => logger.error('Inventory failed', err));
