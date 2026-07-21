/**
 * SMHI SVAR huvudavrinningsområden — download-first (WFS → GPKG + manifest).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getHarvestPath } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const WFS_URL =
  'https://opendata-view.smhi.se/SMHI_vatten_RiverBasin/HY.PhysicalWaters.Catchments/wfs';
const FEATURE_TYPE = 'SMHI_vatten_RiverBasin:HY.PhysicalWaters.Catchments';

async function main() {
  const targetDir = getHarvestPath('SMHI', 'huvudavrinningsomraden_svar_2022');
  const rawDir = path.join(targetDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const outputFile = path.join(rawDir, 'huvudavrinningsomraden_svar_2022.gpkg');
  console.log(`Harvesting SMHI SVAR → ${outputFile}`);

  const result = spawnSync(
    OGR2OGR_PATH,
    [
      '-f',
      'GPKG',
      outputFile,
      `WFS:${WFS_URL}`,
      FEATURE_TYPE,
      '-nln',
      'huvudavrinningsomraden',
      '-t_srs',
      'EPSG:3006',
      '-overwrite',
      '-skipfailures',
    ],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    throw new Error(`ogr2ogr failed with exit ${result.status}`);
  }

  await createManifest(rawDir, {
    provider: 'SMHI',
    dataset: 'huvudavrinningsomraden_svar_2022',
    version: new Date().toISOString().split('T')[0],
    source_url: WFS_URL,
    provenance: 'harvested',
  });

  console.log('✅ SMHI SVAR harvested to Master Archive.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
