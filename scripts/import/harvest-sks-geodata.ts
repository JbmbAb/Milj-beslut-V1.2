import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { getExpectedColumns } from './config/importRegistry';
import { getHarvestPath } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';
import { calculateBundleHash, calculateFileHash } from './utils/harvesting';

// Starta dotenv innan något annat
dotenv.config();

const SKS_FEEDS: Record<string, { feedUrl: string; registryDataset: string; zipName: string; layerName: string }> = {
  Nyckelbiotoper: {
    feedUrl: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/Nyckelbiotoper.xml',
    registryDataset: 'SksNyckelbiotoper',
    zipName: 'sksNyckelbiotoper_gpkg.zip',
    layerName: 'sksNyckelbiotoper',
  },
  Biotopskydd: {
    feedUrl: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/biotopskydd.xml',
    registryDataset: 'SksBiotopskydd',
    zipName: 'sksBiotopskydd_gpkg.zip',
    layerName: 'sksBiotopskydd',
  },
  Naturvardsavtal: {
    feedUrl: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/Naturvardsavtal.xml',
    registryDataset: 'SksNaturvardsavtal',
    zipName: 'sksNaturvardsavtal_gpkg.zip',
    layerName: 'sksNaturvardsavtal',
  },
  Avverkningsanmalan: {
    feedUrl: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/AvverkAnm.xml',
    registryDataset: 'SksAvverkningsanmalan',
    zipName: 'sksAvverkAnm_gpkg.zip',
    layerName: 'AvverkAnm',
  },
};

async function writeV2Manifest(
  rawDir: string,
  id: string,
  registryDataset: string,
  primaryRelPath: string,
  primaryPath: string,
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
  const primaryHash = await calculateFileHash(primaryPath);

  const manifest = buildArchiveManifestV2({
    provider: 'Skogsstyrelsen',
    dataset: registryDataset,
    version: new Date().toISOString().split('T')[0]!,
    total_bytes,
    files: [primaryRelPath.replace(/\\/g, '/')],
    content_bundle_sha256,
    provenance: 'sks_atom_feed',
    source_url: sourceUrl,
    license: 'Öppen data (Skogsstyrelsen)',
    qa_status: 'pending',
    expected_columns: [...getExpectedColumns('Skogsstyrelsen', registryDataset)],
    files_detail: [
      {
        name: path.basename(primaryPath),
        sha256: primaryHash,
        size_bytes: fs.statSync(primaryPath).size,
        rel_path: primaryRelPath.replace(/\\/g, '/'),
      },
    ],
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
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  let targetKeys = Object.keys(SKS_FEEDS);

  if (onlyArg) {
    targetKeys = targetKeys.filter((k) => k.toLowerCase() === onlyArg.toLowerCase());
  }

  console.log('=== Starting Skogsstyrelsen Geodata Harvesting Pipeline ===');

  for (const key of targetKeys) {
    const config = SKS_FEEDS[key]!;
    console.log(`\nProcessing theme: ${key}`);
    console.log(`  Feed URL: ${config.feedUrl}`);

    // 1. Hämta XML-feed
    let feedXml: string;
    try {
      const response = await fetch(config.feedUrl);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      feedXml = await response.text();
    } catch (err) {
      console.error(`  Error fetching feed XML: ${(err as Error).message}`);
      continue;
    }

    // 2. Extrahera ZIP-länk via regex
    // Leta efter en zip-länk inuti feeden
    const zipLinkRegex = /<link[^>]*href="([^"]+\.zip)"[^>]*type="application\/zip"/i;
    const match = feedXml.match(zipLinkRegex);
    let zipUrl = match ? match[1] : null;

    if (!zipUrl) {
      // Fallback: leta efter valfri länk till en .zip-fil
      const fallbackRegex = /href="([^"]+\.zip)"/i;
      const fallbackMatch = feedXml.match(fallbackRegex);
      zipUrl = fallbackMatch ? fallbackMatch[1] : null;
    }

    if (!zipUrl) {
      console.error(`  Error: Could not extract zip download link from Atom feed XML.`);
      continue;
    }

    console.log(`  Found ZIP download URL: ${zipUrl}`);

    // 3. Förbered kataloger på M:\ (eller GEO_Master_Archive via MASTER_ARCHIVE_ROOT)
    const harvestDir = getHarvestPath('Skogsstyrelsen', config.registryDataset);
    const rawDir = path.join(harvestDir, 'raw');
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const zipTempPath = path.join(rawDir, config.zipName);
    console.log(`  Downloading to temporary path: ${zipTempPath}`);

    // 4. Ladda ner filen
    try {
      const response = await fetch(zipUrl);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(zipTempPath, Buffer.from(buffer));
      console.log(`  Download complete. Size: ${(fs.statSync(zipTempPath).size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      console.error(`  Error downloading ZIP: ${(err as Error).message}`);
      continue;
    }

    // 5. Packa upp ZIP-filen med PowerShell
    console.log(`  Extracting ZIP archive...`);
    const extractDir = path.join(rawDir, 'extracted');
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    // Kör PowerShell Expand-Archive
    const psCmd = `Expand-Archive -Path "${zipTempPath}" -DestinationPath "${extractDir}" -Force`;
    const psResult = spawnSync('powershell.exe', ['-Command', psCmd], { encoding: 'utf-8' });

    if (psResult.status !== 0) {
      console.error(`  Error: Failed to extract ZIP archive using PowerShell:`, psResult.stderr);
      continue;
    }

    // Ta bort den temporära zip-filen efter lyckad extraktion för att spara disk
    fs.unlinkSync(zipTempPath);

    // 6. Hitta GPKG-filen i den uppackade katalogen och flytta den till rawDir rot
    const extractedFiles = fs.readdirSync(extractDir);
    const gpkgFile = extractedFiles.find((f) => f.toLowerCase().endsWith('.gpkg'));

    if (!gpkgFile) {
      console.error(`  Error: No .gpkg file found in the extracted ZIP archive.`);
      console.log(`  Files found:`, extractedFiles);
      continue;
    }

    const srcGpkgPath = path.join(extractDir, gpkgFile);
    const destGpkgName = `${key.toLowerCase()}.gpkg`;
    const destGpkgPath = path.join(rawDir, destGpkgName);

    fs.renameSync(srcGpkgPath, destGpkgPath);
    console.log(`  Extracted and renamed GPKG: ${gpkgFile} -> ${destGpkgName}`);

    // Ta bort den tomma extraherade mappen
    fs.rmSync(extractDir, { recursive: true, force: true });

    // 7. Skriv manifest.json och checksums.txt (v2)
    await writeV2Manifest(
      rawDir,
      key,
      config.registryDataset,
      destGpkgName,
      destGpkgPath,
      zipUrl,
    );

    console.log(`  Manifest and checksums written successfully.`);
    console.log(`  Theme ${key} harvested successfully.`);
  }

  console.log('\n=== Skogsstyrelsen Ingestion Pipeline Completed Successfully ===');
}

main().catch(console.error);
