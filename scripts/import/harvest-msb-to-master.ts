/**
 * MSB Harvester (Mimers Brunn compliant)
 * 
 * Downloads flood risk data from MSB WFS to the Master Archive.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { getHarvestPath } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const MSB_COLLECTIONS = [
  { id: 'InspireMSB_oversvam', url: 'https://gis-services.msb.se/geoserver/InspireMSB_oversvam/wfs', layers: ['InspireMSB_oversvam:Oversvamningsomrade'] },
  { id: 'InspireMSB_APSFR', url: 'https://gis-services.msb.se/geoserver/InspireMSB_APSFR/wfs', layers: ['InspireMSB_APSFR:APSFR_omrade'] },
];

async function harvest() {
  console.log('🚀 MSB HARVESTER (Mimers Brunn)');
  
  for (const collection of MSB_COLLECTIONS) {
    const targetDir = getHarvestPath('MSB', collection.id);
    const rawDir = path.join(targetDir, 'raw');
    
    console.log(`\n📦 Harvesting: ${collection.id}`);
    
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const outputFile = path.join(rawDir, `${collection.id}.gpkg`);
    
    const ogrArgs = [
      '-f', 'GPKG',
      outputFile,
      `WFS:${collection.url}`,
      ...collection.layers,
      '-t_srs', 'EPSG:3006',
      '-overwrite',
      '-skipfailures'
    ];

    console.log(`   - Downloading via ogr2ogr...`);
    const result = spawnSync(OGR2OGR_PATH, ogrArgs, { stdio: 'inherit' });

    if (result.status !== 0) {
      console.error(`   ❌ Failed to download ${collection.id}`);
      continue;
    }

    console.log(`   - Generating manifest and checksums...`);
    await createManifest(rawDir, {
      provider: 'MSB',
      dataset: collection.id,
      version: new Date().toISOString().split('T')[0],
      source_url: collection.url,
      provenance: 'harvested',
    });

    console.log(`   ✅ Successfully harvested ${collection.id}`);
  }
}

harvest().catch(err => {
  console.error('Fatal error during harvest:', err);
  process.exit(1);
});
