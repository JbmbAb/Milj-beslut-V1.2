import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { getHarvestPath, MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';
import { calculateBundleHash, calculateFileHash } from './utils/harvesting';

dotenv.config();

const FEED_URL = 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/SLUMarkfuktighetKlassad.xml';
const DATASET_ID = 'SLUMarkfuktighetKlassad';

// Staging directory to prevent virtual drive Dokan/WinFsp mkdir errors
const LOCAL_STAGING_DIR = process.env.LOCAL_STAGING_DIR || path.join(os.tmpdir(), 'miljobeslut_staging', 'harvest_temp', 'Skogsstyrelsen', 'SLUMarkfuktighetKlassad');

async function writeV2Manifest(
  rawDir: string,
  primaryFiles: string[],
  sourceUrl: string,
): Promise<void> {
  const bundlePaths = fs
    .readdirSync(rawDir, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .map((rel) => path.join(rawDir, rel))
    .filter((fp) => fs.statSync(fp).isFile())
    .filter((fp) => !['manifest.json', 'checksums.txt'].includes(path.basename(fp)));

  const content_bundle_sha256 = await calculateBundleHash(bundlePaths);
  const total_bytes = bundlePaths.reduce((acc, fp) => acc + fs.statSync(fp).size, 0);

  const filesDetail = await Promise.all(
    primaryFiles.map(async (file) => {
      const fullPath = path.join(rawDir, file);
      const sha256 = await calculateFileHash(fullPath);
      return {
        name: file,
        sha256,
        size_bytes: fs.statSync(fullPath).size,
        rel_path: file,
      };
    })
  );

  const manifest = buildArchiveManifestV2({
    provider: 'Skogsstyrelsen',
    dataset: DATASET_ID,
    version: new Date().toISOString().split('T')[0]!,
    total_bytes,
    files: primaryFiles,
    content_bundle_sha256,
    provenance: 'sks_atom_feed_slu_markfuktighet',
    source_url: sourceUrl,
    license: 'Öppen data (SLU/Skogsstyrelsen)',
    qa_status: 'pending',
    expected_columns: [], // Raster dataset - no columns
    files_detail: filesDetail,
  });

  fs.writeFileSync(path.join(rawDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const checksums = await Promise.all(
    bundlePaths.map(async (fp) => {
      const rel = path.relative(rawDir, fp).replace(/\\/g, '/');
      return `${await calculateFileHash(fp)}  ${rel}`;
    }),
  );
  fs.writeFileSync(path.join(rawDir, 'checksums.txt'), `${checksums.join('\n')}\n`, 'utf8');
}

async function main() {
  console.log('=== Starting Skogsstyrelsen SLU Markfuktighet Harvester ===');
  console.log(`Feed URL: ${FEED_URL}\n`);

  // 1. Fetch Atom feed XML
  let feedXml: string;
  try {
    const response = await fetch(FEED_URL);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
    feedXml = await response.text();
  } catch (err) {
    console.error(`❌ Error fetching feed XML: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Extract all ZIP URLs
  const zipUrlRegex = /https:\/\/geodpags\.skogsstyrelsen\.se\/geodataport\/data\/sksSLUMarkfuktighet_klassad\d+\.zip/gi;
  const zipUrls = feedXml.match(zipUrlRegex) || [];

  if (zipUrls.length === 0) {
    console.error('❌ Error: Could not find any ZIP URLs in the feed.');
    process.exit(1);
  }

  // Deduplicate URLs
  const uniqueUrls = [...new Set(zipUrls)];
  console.log(`Found ${uniqueUrls.length} county ZIP URLs to download.`);

  // 3. Prepare local staging raw directory on D:
  let timestamp = '';
  
  // Try H: first since it holds the archived files from the previous run
  const canonicalParent = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'Skogsstyrelsen', DATASET_ID);
  if (fs.existsSync(canonicalParent)) {
    const existingDirs = fs.readdirSync(canonicalParent)
      .filter((d) => {
        try {
          return fs.statSync(path.join(canonicalParent, d)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.localeCompare(a));
    if (existingDirs.length > 0) {
      timestamp = existingDirs[0]!;
      console.log(`♻️ Found Master Archive folder, resuming: ${timestamp}`);
    }
  }

  // Fallback to D: staging folder
  if (!timestamp && fs.existsSync(LOCAL_STAGING_DIR)) {
    const existingDirs = fs.readdirSync(LOCAL_STAGING_DIR)
      .filter((d) => {
        try {
          return fs.statSync(path.join(LOCAL_STAGING_DIR, d)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.localeCompare(a));
    if (existingDirs.length > 0) {
      timestamp = existingDirs[0]!;
      console.log(`♻️ Found local staging folder, resuming: ${timestamp}`);
    }
  }

  // If still no folder, generate a new timestamp
  if (!timestamp) {
    timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0]!;
    console.log(`🆕 Creating new folder: ${timestamp}`);
  }

  const localRawDir = path.join(LOCAL_STAGING_DIR, timestamp, 'raw');
  fs.mkdirSync(localRawDir, { recursive: true });
  console.log(`Local Staging Directory (D:): ${localRawDir}\n`);

  const downloadedRasters: string[] = [];

  // 4. Download and extract each county ZIP to D:
  for (let idx = 0; idx < uniqueUrls.length; idx++) {
    const url = uniqueUrls[idx]!;
    const filename = path.basename(url);
    const countyCode = filename.match(/\d+/)?.[0] || String(idx + 1);

    const destTifName = `sksSLUmfMarkfuktighet_klassad${countyCode}.tif`;
    const destTifPath = path.join(localRawDir, destTifName);
    const canonicalTifPath = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'Skogsstyrelsen', DATASET_ID, timestamp, 'raw', destTifName);

    if (fs.existsSync(destTifPath)) {
      console.log(`[${idx + 1}/${uniqueUrls.length}] County ${countyCode} already processed locally. Skipping.`);
      downloadedRasters.push(destTifName);
      continue;
    }

    if (fs.existsSync(canonicalTifPath)) {
      console.log(`[${idx + 1}/${uniqueUrls.length}] County ${countyCode} exists in Master Archive. Copying to D:...`);
      try {
        fs.copyFileSync(canonicalTifPath, destTifPath);
        const canonicalTfwPath = canonicalTifPath.replace(/\.tif$/, '.tfw');
        const destTfwPath = destTifPath.replace(/\.tif$/, '.tfw');
        if (fs.existsSync(canonicalTfwPath)) {
          fs.copyFileSync(canonicalTfwPath, destTfwPath);
        }
        downloadedRasters.push(destTifName);
        continue;
      } catch (copyErr) {
        console.warn(`  ⚠️ Warning: Could not copy ${destTifName} back from H: (${(copyErr as Error).message}). Will re-download.`);
      }
    }

    console.log(`[${idx + 1}/${uniqueUrls.length}] Downloading county ${countyCode} via curl (with resume/continue support)...`);
    console.log(`  URL: ${url}`);

    const zipTempPath = path.join(localRawDir, filename);

    // Download using curl.exe with standard browser User-Agent and resume/continue flag in a retry loop
    let success = false;
    let retries = 0;
    const maxRetries = 15;

    while (!success && retries < maxRetries) {
      if (retries > 0) {
        console.log(`  🔄 Retrying download (attempt ${retries + 1}/${maxRetries}), resuming from last byte...`);
        spawnSync('powershell.exe', ['-Command', 'Start-Sleep -Seconds 2']);
      }

      const curlResult = spawnSync('curl.exe', [
        '-L',
        '-C', '-', // Resume transfer from last byte
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-o', zipTempPath,
        url
      ], { stdio: 'inherit' });

      if (curlResult.status === 0) {
        success = true;
      } else {
        retries++;
        console.warn(`  ⚠️ curl interrupted (exit code ${curlResult.status}).`);
      }
    }

    if (!success) {
      console.error(`  ❌ Error downloading county ${countyCode} after ${maxRetries} attempts.`);
      if (fs.existsSync(zipTempPath)) {
        fs.unlinkSync(zipTempPath);
      }
      continue;
    }
    console.log(`  Downloaded successfully. Size: ${(fs.statSync(zipTempPath).size / 1024 / 1024).toFixed(2)} MB`);

    // Extract the ZIP archive
    const extractDir = path.join(localRawDir, `extract_${countyCode}`);
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    console.log(`  Extracting...`);
    const psCmd = `Expand-Archive -Path "${zipTempPath}" -DestinationPath "${extractDir}" -Force`;
    const psResult = spawnSync('powershell.exe', ['-Command', psCmd], { encoding: 'utf-8' });

    // Delete the ZIP file immediately to save space
    fs.unlinkSync(zipTempPath);

    if (psResult.status !== 0) {
      console.error(`  ❌ Extraction failed:`, psResult.stderr);
      fs.rmSync(extractDir, { recursive: true, force: true });
      continue;
    }

    // Move extracted files to localRawDir root and clean up
    const files = fs.readdirSync(extractDir);
    for (const file of files) {
      const srcPath = path.join(extractDir, file);
      const destPath = path.join(localRawDir, file);
      fs.renameSync(srcPath, destPath);

      if (file.toLowerCase().endsWith('.tif')) {
        downloadedRasters.push(file);
      }
    }

    // Remove the temp folder
    fs.rmSync(extractDir, { recursive: true, force: true });
    console.log(`  County ${countyCode} processed successfully.`);
  }

  if (downloadedRasters.length === 0) {
    console.error('❌ Error: No raster files were successfully prepared.');
    process.exit(1);
  }

  // 5. Write manifest.json and checksums.txt on D:
  console.log(`\nWriting Mimers Brunn V2 Manifest and checksums...`);
  await writeV2Manifest(localRawDir, downloadedRasters, FEED_URL);

  // 6. Copy finalized raw directory to H: (Master Archive)
  const canonicalDir = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'Skogsstyrelsen', DATASET_ID, timestamp, 'raw');
  console.log(`\n🚚 Copying completed dataset to Master Archive:`);
  console.log(`  From: ${localRawDir}`);
  console.log(`  To  : ${canonicalDir}`);

  // Create target directory on H: using PowerShell to prevent Dokan mkdir errors
  spawnSync('powershell.exe', ['-Command', `New-Item -ItemType Directory -Force -Path "${canonicalDir}"`], { encoding: 'utf-8' });

  // Use robocopy to copy the files to the Google Drive mount
  const robocopyResult = spawnSync('robocopy', [localRawDir, canonicalDir, '*.*', '/E', '/R:3', '/W:10', '/MT:4'], { encoding: 'utf-8' });
  const code = robocopyResult.status ?? 0;
  
  if (downloadedRasters.length === uniqueUrls.length && code >= 0 && code < 8) {
    console.log(`✅ Copying completed successfully! All 21 counties are archived.`);
    
    // Clean up local staging files on D: after successful sync to save disk space
    console.log(`🧹 Cleaning up local staging files on D:...`);
    fs.rmSync(path.dirname(localRawDir), { recursive: true, force: true });
  } else {
    if (code >= 0 && code < 8) {
      console.log(`✅ Copying of current batch completed successfully!`);
    } else {
      console.error(`❌ Error: Robocopy failed with exit code ${code}.`);
    }
    console.log(`⚠️ Staging directory kept at ${localRawDir} for resumption (${downloadedRasters.length}/${uniqueUrls.length} files done).`);
  }

  console.log('\n=== Skogsstyrelsen SLU Markfuktighet Harvester Completed Successfully ===');
  console.log(`Dataset archived at: ${canonicalDir}`);
}

main().catch(console.error);
