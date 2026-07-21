import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { SGU_HARVEST_SOURCES, getSguHarvestSource } from './config/sguHarvestSources';
import { getExpectedColumns } from './config/importRegistry';
import { getHarvestPath } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';
import { calculateBundleHash, calculateFileHash } from './utils/harvesting';
import { harvestSguCollection } from './utils/sguOapifHarvest';

dotenv.config();

async function writeV2Manifest(
  rawDir: string,
  source: ReturnType<typeof getSguHarvestSource> & { id: string; registryDataset: string; license: string },
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

async function main() {
  const onlyArg = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
  let targetIds = ['Kallor', 'Borrhal', 'Grundvattenforekomster', 'MaringeologiYtsubstrat'];
  if (onlyArg) {
    targetIds = targetIds.filter(id => id.toLowerCase() === onlyArg.toLowerCase());
  }

  console.log('=== Starting SGU Quad Ingestion Pipeline (Mimers Brunn Compliant) ===');

  for (const id of targetIds) {
    const source = getSguHarvestSource(id);
    if (!source || !source.apiCollectionUrl) {
      console.error(`Error: Source config for ${id} is invalid or missing apiCollectionUrl.`);
      continue;
    }

    console.log(`\nHarvesting ${id} from OGC API...`);
    // Skapa canonical path på H: (motsvarande H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\SGU\<id>\<TIDSTÄMPEL>\raw\)
    const rawDir = path.join(getHarvestPath('SGU', id), 'raw');
    
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const outputFile = path.join(rawDir, `${id.toLowerCase()}.gpkg`);
    const workDir = path.join(rawDir, '.harvest-work');

    console.log(`  Target directory : ${rawDir}`);
    console.log(`  Output file      : ${outputFile}`);

    // Hämta via OGC API Features
    const result = await harvestSguCollection({
      collection: { id: source.id, url: source.apiCollectionUrl },
      outputGpkg: outputFile,
      workDir,
      resume: false,
      onPage: ({ pageNumber, startIndex, returned, totalWritten, numberMatched }) => {
        console.log(
          `    page ${pageNumber}: startIndex=${startIndex} returned=${returned} total=${totalWritten} numberMatched=${numberMatched}`,
        );
      },
    });

    if (!result.success) {
      console.error(`  Error harvesting SGU collection ${id}: ${result.error}`);
      continue;
    }

    console.log(`  Successfully harvested ${id}. Feature count: ${result.gpkgFeatureCount}`);

    // Skriv manifest.json och checksums.txt (Librarian QA krav)
    const relGpkgPath = path.relative(rawDir, outputFile);
    await writeV2Manifest(
      rawDir,
      source as any,
      relGpkgPath,
      outputFile,
      source.apiCollectionUrl,
      'sgu_ogc_api_features'
    );

    console.log(`  Generated manifest.json and checksums.txt in ${rawDir}`);
  }

  console.log('\n=== SGU Quad Ingestion Pipeline Completed Successfully ===');
}

main().catch(console.error);
