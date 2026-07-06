/**
 * Merge MSB översvämnings-GPKG:er (100/200/BHF) till ett Librarian-ready paket.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const VERSION = process.env.MSB_OVERSVAMNING_VERSION || new Date().toISOString().split('T')[0];
const SOURCE_LAYERS = [
  { fileName: 'msb_oversvamning_100ar.gpkg', returnPeriod: '100' },
  { fileName: 'msb_oversvamning_200ar.gpkg', returnPeriod: '200' },
  { fileName: 'msb_oversvamning_bhf.gpkg', returnPeriod: 'BHF' },
] as const;

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runOgr2Ogr(args: string[]): void {
  const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`ogr2ogr failed with exit ${result.status}`);
  }
}

function findLatestHarvestRawDir(): string {
  const root = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'MSB', 'oversvamning_nationell');
  const versions = fs
    .readdirSync(root)
    .filter((entry) => fs.statSync(path.join(root, entry)).isDirectory())
    .sort();
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const rawDir = path.join(root, versions[index], 'raw');
    if (SOURCE_LAYERS.every((layer) => fs.existsSync(path.join(rawDir, layer.fileName)))) {
      return rawDir;
    }
  }
  throw new Error('No complete MSB oversvamning harvest found (need 100/200/BHF GPKG).');
}

function main(): void {
  const sourceRawDir = findLatestHarvestRawDir();
  const outputDir = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'MSB', 'oversvamning_nationell', VERSION);
  const rawDir = path.join(outputDir, 'raw');
  const gpkgPath = path.join(rawDir, 'msb_oversvamning_nationell.gpkg');
  fs.mkdirSync(rawDir, { recursive: true });

  if (fs.existsSync(gpkgPath)) fs.unlinkSync(gpkgPath);

  SOURCE_LAYERS.forEach((layer, index) => {
    const sourcePath = path.join(sourceRawDir, layer.fileName);
    runOgr2Ogr([
      '-f',
      'GPKG',
      gpkgPath,
      sourcePath,
      'oversvamningszon',
      '-sql',
      `SELECT *, '${layer.returnPeriod}' AS return_period FROM oversvamningszon`,
      '-nln',
      'oversvamningszon',
      '-makevalid',
      '-nlt',
      'PROMOTE_TO_MULTI',
      '-t_srs',
      'EPSG:3006',
      ...(index === 0 ? ['-overwrite'] : ['-append']),
    ]);
  });

  const bundleHash = sha256File(gpkgPath);
  const totalBytes = fs.statSync(gpkgPath).size;
  const manifest = buildArchiveManifestV2({
    provider: 'MSB',
    dataset: 'oversvamning_nationell',
    version: VERSION,
    total_bytes: totalBytes,
    files: ['raw/msb_oversvamning_nationell.gpkg'],
    content_bundle_sha256: bundleHash,
    provenance: 'msb_ogc_api_features_merged_national',
    source_url: 'https://inspire.msb.se/geoserver/oversvamning/ogc/features/v1/collections',
    license: 'CC0',
    expected_columns: ['return_period', 'typeofhazard', 'objectid', 'likelihoodofoccurence'],
    files_detail: [
      {
        name: 'raw/msb_oversvamning_nationell.gpkg',
        sha256: bundleHash,
        size_bytes: totalBytes,
      },
    ],
  });

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Prepared ${gpkgPath}`);
  console.log(`Manifest ${path.join(outputDir, 'manifest.json')}`);
}

main();
