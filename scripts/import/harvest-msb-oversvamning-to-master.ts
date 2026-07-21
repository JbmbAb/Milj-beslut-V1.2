/**
 * MSB översvämningskartering — download-first (OGC API Features → GPKG + manifest).
 *
 * Vektorerna för 100-/200-årsflöden publiceras nationellt via inspire.msb.se.
 * WFS bulk (ogr2ogr WFS:) är instabil ("transfer closed"); OGC API Features GeoJSON fungerar.
 *
 * Lastkaj (lastkaj.mcf.se/Karteringar/oversvamning-*) innehåller metod-PDF:er per
 * vattendrag/kust/äl v/Mälaren — se harvest-mcf-oversvamning-pdfs-to-master.ts.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getHarvestPath } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const OAPI_BASE = 'https://inspire.msb.se/geoserver/oversvamning/ogc/features/v1/collections';

const LAYERS = [
  { collection: 'NZ_Oversvamning_100', fileName: 'msb_oversvamning_100ar.gpkg', returnPeriod: '100' },
  { collection: 'NZ_Oversvamning_200', fileName: 'msb_oversvamning_200ar.gpkg', returnPeriod: '200' },
  { collection: 'NZ_Oversvamning_BHF', fileName: 'msb_oversvamning_bhf.gpkg', returnPeriod: 'BHF' },
] as const;

function runOgr2Ogr(args: string[]): void {
  const result = spawnSync(OGR2OGR_PATH, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      GDAL_HTTP_TIMEOUT: '600',
    },
  });
  if (result.status !== 0) {
    throw new Error(`ogr2ogr failed with exit ${result.status}`);
  }
}

function assertNonEmptyGpkg(gpkgPath: string): void {
  const stat = fs.statSync(gpkgPath);
  if (stat.size < 1024 * 1024) {
    throw new Error(`Harvest produced suspiciously small GPKG (${stat.size} bytes): ${gpkgPath}`);
  }
}

async function main(): Promise<void> {
  const targetDir = getHarvestPath('MSB', 'oversvamning_nationell');
  const rawDir = path.join(targetDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  console.log(`Harvesting MSB översvämningskartering → ${rawDir}`);

  for (const layer of LAYERS) {
    const outputFile = path.join(rawDir, layer.fileName);
    const geoJsonUrl = `${OAPI_BASE}/${layer.collection}/items?f=application/geo%2Bjson`;
    console.log(`\n→ ${layer.collection} (${layer.returnPeriod})`);
    runOgr2Ogr([
      '-f',
      'GPKG',
      outputFile,
      `GeoJSON:${geoJsonUrl}`,
      '-nln',
      'oversvamningszon',
      '-t_srs',
      'EPSG:3006',
      '-overwrite',
      '-skipfailures',
    ]);
    assertNonEmptyGpkg(outputFile);
    console.log(`   OK ${(fs.statSync(outputFile).size / (1024 * 1024)).toFixed(1)} MB`);
  }

  await createManifest(rawDir, {
    provider: 'MSB',
    dataset: 'oversvamning_nationell',
    version: new Date().toISOString().split('T')[0],
    source_url: OAPI_BASE,
    provenance: 'harvested_msb_ogc_api_features',
  });

  console.log('\n✅ MSB översvämningskartering harvested to Master Archive.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
