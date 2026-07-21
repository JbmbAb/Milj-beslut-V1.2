/**
 * VISS & SMED Harvester (Mimers Brunn compliant)
 * 
 * Downloads data from VISS WFS and other sources to the Master Archive as GeoPackage.
 * Generates manifests and checksums for the Librarian.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { getHarvestPath } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const COLLECTIONS = [
  { 
    id: 'viss_vattenforekomster', 
    provider: 'VISS',
    url: 'WFS:https://ext-geodata.lansstyrelsen.se/viss/wfs',
    layers: ['viss:Vattenforekomst_Sverige_Ytor_ver3']
  },
  { 
    id: 'smed_belastning_vatten', 
    provider: 'SMED',
    url: 'WFS:https://ext-geodata.lansstyrelsen.se/viss/wfs',
    layers: ['viss:SMED_Belastning_Vatten_Ytor']
  },
  { 
    id: 'lst_vattenskydd', 
    provider: 'LST',
    url: 'WFS:https://ext-geodata.lansstyrelsen.se/viss/wfs',
    layers: ['viss:Vattenskyddsomraden_Sverige']
  },
];

async function harvest() {
  console.log('🚀 VISS/SMED HARVESTER (Mimers Brunn)');
  
  const vissKey = process.env.VISS_API_KEY;
  const env = { ...process.env };
  if (vissKey) {
    env.GDAL_HTTP_HEADERS = `apikey: ${vissKey}`;
  }

  for (const collection of COLLECTIONS) {
    const targetDir = getHarvestPath(collection.provider, collection.id);
    const rawDir = path.join(targetDir, 'raw');
    
    console.log(`\n📦 Harvesting: ${collection.id}`);
    console.log(`   Target: ${targetDir}`);
    
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const outputFile = path.join(rawDir, `${collection.id}.gpkg`);
    
    const ogrArgs = [
      '-f', 'GPKG',
      outputFile,
      collection.url,
      ...collection.layers,
      '-nln', collection.id,
      '-t_srs', 'EPSG:3006',
      '-overwrite',
      '-skipfailures'
    ];

    console.log(`   - Downloading via ogr2ogr...`);
    const result = spawnSync(OGR2OGR_PATH, ogrArgs, { stdio: 'inherit', env });

    if (result.status !== 0) {
      console.error(`   ❌ Failed to download ${collection.id}`);
      continue;
    }

    console.log(`   - Generating manifest and checksums...`);
    await createManifest(rawDir, {
      provider: collection.provider,
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
