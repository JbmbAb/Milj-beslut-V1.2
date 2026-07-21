/**
 * SGU Harvester (Mimers Brunn compliant)
 *
 * Strategy:
 *   - ZIP-first when SGU publishes bulk download (official GPKG, correct CRS)
 *   - OGC API HTTP pagination + chunked ogr2ogr as fallback / partial test
 *
 * Usage:
 *   npx tsx scripts/import/harvest-sgu-to-master.ts --only=Jordarter25k100k --strategy=zip
 *   npx tsx scripts/import/harvest-sgu-to-master.ts --only=Jordarter25k100k --strategy=api --limit=25001
 *   npx tsx scripts/import/harvest-sgu-to-master.ts --only=Jordarter25k100k --strategy=zip --local-raw=storage/manifests/sgu-jordart-zip
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { SGU_HARVEST_SOURCES, getSguHarvestSource } from './config/sguHarvestSources';
import { getExpectedColumns } from './config/importRegistry';
import { getHarvestPath } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';
import { calculateBundleHash, calculateFileHash } from './utils/harvesting';
import { harvestSguCollection } from './utils/sguOapifHarvest';
import { harvestSguZip } from './utils/sguZipHarvest';

dotenv.config();

type HarvestStrategy = 'zip' | 'api' | 'auto';

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function resolveStrategy(source: ReturnType<typeof getSguHarvestSource>, explicit?: string): HarvestStrategy {
  const value = (explicit ?? 'auto') as HarvestStrategy;
  if (value === 'auto') {
    return source?.zip ? 'zip' : 'api';
  }
  return value;
}

async function writeV2Manifest(
  rawDir: string,
  source: NonNullable<ReturnType<typeof getSguHarvestSource>>,
  primaryRelPath: string,
  primaryPath: string,
  sourceUrl: string,
  provenance: string,
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
    provider: 'SGU',
    dataset: source.registryDataset,
    version: new Date().toISOString().split('T')[0]!,
    total_bytes,
    files: [primaryRelPath.replace(/\\/g, '/')],
    content_bundle_sha256,
    provenance,
    source_url: sourceUrl,
    license: source.license,
    qa_status: 'pending',
    expected_columns: [...getExpectedColumns('SGU', source.registryDataset)],
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

async function harvestZipSource(
  source: NonNullable<ReturnType<typeof getSguHarvestSource>>,
  rawDir: string,
  skipDownload: boolean,
): Promise<boolean> {
  const result = await harvestSguZip({
    source,
    rawDir,
    skipDownload,
    skipExtract: skipDownload,
  });

  if (!result.success || !result.verify) {
    console.error(`   ZIP harvest failed: ${result.error ?? 'unknown'}`);
    return false;
  }

  console.log(`   Verified ${result.verify.featureCount.toLocaleString('sv-SE')} features in ${result.verify.layer}`);
  console.log(`   Verify report: ${result.verifyReportPath}`);

  const gpkgRel = path.relative(rawDir, result.gpkgPath);
  await writeV2Manifest(rawDir, source, gpkgRel, result.gpkgPath, source.zip!.zipUrl, 'sgu_official_zip');
  return true;
}

async function harvestApiSource(
  source: NonNullable<ReturnType<typeof getSguHarvestSource>>,
  rawDir: string,
  featureLimit: number | undefined,
  resume: boolean,
): Promise<boolean> {
  if (!source.apiCollectionUrl) {
    console.error(`   No API collection URL for ${source.id}`);
    return false;
  }

  const workDir = path.join(rawDir, '.harvest-work');
  const outputFile = path.join(rawDir, `${source.id}.gpkg`);

  const result = await harvestSguCollection({
    collection: { id: source.id, url: source.apiCollectionUrl },
    outputGpkg: outputFile,
    workDir,
    featureLimit,
    resume,
    onPage: ({ pageNumber, startIndex, returned, totalWritten, numberMatched }) => {
      console.log(
        `   page ${pageNumber}: startIndex=${startIndex} returned=${returned} total=${totalWritten} numberMatched=${numberMatched}`,
      );
    },
  });

  if (!result.success) {
    console.error(`   API harvest failed: ${result.error ?? 'unknown'}`);
    console.error(`   Checkpoint: ${result.checkpointPath}`);
    return false;
  }

  if (fs.existsSync(workDir)) {
    const pageLog = path.join(workDir, 'pagination.log');
    if (fs.existsSync(pageLog)) {
      fs.copyFileSync(pageLog, path.join(rawDir, 'harvest-pagination.log'));
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  await writeV2Manifest(
    rawDir,
    source,
    `${source.id}.gpkg`,
    outputFile,
    source.apiCollectionUrl,
    'sgu_oapif_pagination',
  );
  return true;
}

async function harvest() {
  const only = readArg('only');
  const strategyArg = readArg('strategy') as HarvestStrategy | undefined;
  const localRaw = readArg('local-raw');
  const limitArg = readArg('limit');
  const featureLimit = limitArg ? Number(limitArg) : undefined;
  const resume = hasFlag('resume');
  const skipDownload = hasFlag('skip-download');

  const sources = only ? SGU_HARVEST_SOURCES.filter((s) => s.id === only) : SGU_HARVEST_SOURCES;

  if (sources.length === 0) {
    console.error(`Unknown collection: ${only}. Valid: ${SGU_HARVEST_SOURCES.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }

  console.log('SGU HARVESTER (Mimers Brunn — ZIP-first, API fallback)');

  let hadFailure = false;

  for (const source of sources) {
    const strategy = resolveStrategy(source, strategyArg);
    const rawDir = readArg('raw-dir')
      ? path.resolve(readArg('raw-dir')!)
      : localRaw
        ? path.join(path.resolve(localRaw), 'raw')
        : path.join(getHarvestPath('SGU', source.id), 'raw');
    const targetDir = path.dirname(rawDir);

    console.log(`\nHarvesting: ${source.id} [strategy=${strategy}]`);
    console.log(`   Registry dataset: ${source.registryDataset}`);
    console.log(`   Target: ${targetDir}`);

    fs.mkdirSync(rawDir, { recursive: true });

    let ok = false;
    if (strategy === 'zip') {
      if (!source.zip) {
        console.error(`   No ZIP URL configured for ${source.id} — use --strategy=api`);
        hadFailure = true;
        continue;
      }
      ok = await harvestZipSource(source, rawDir, skipDownload);
    } else {
      ok = await harvestApiSource(source, rawDir, featureLimit, resume);
    }

    if (!ok) {
      hadFailure = true;
      continue;
    }

    console.log(`   Manifest v2 written: ${path.join(rawDir, 'manifest.json')}`);
    console.log(`   Successfully harvested ${source.id}`);
  }

  if (hadFailure) process.exit(1);
}

harvest().catch((err) => {
  console.error('Fatal error during harvest:', err);
  process.exit(1);
});
