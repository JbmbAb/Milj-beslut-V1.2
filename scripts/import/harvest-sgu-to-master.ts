/**
 * SGU Harvester (Mimers Brunn compliant)
 * 
 * Downloads data from SGU OGC API to the Master Archive as GeoPackage.
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

const SGU_COLLECTIONS = [
  { id: 'Brunnar', url: 'https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar' },
  { id: 'Jordarter25k100k', url: 'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager' },
  { id: 'Fastmark', url: 'https://api.sgu.se/oppnadata/fastmark/ogc/features/v1/collections/fastmark' },
  { id: 'Grundvatten', url: 'https://api.sgu.se/oppnadata/grundvattenmagasin/ogc/features/v1/collections/grundvattenmagasin' },
  { id: 'Jordskred', url: 'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner' },
  { id: 'AktsamhetEfterarbetad', url: 'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-efterarbetad' },
];

async function harvest() {
  console.log('🚀 SGU HARVESTER (Mimers Brunn)');
  
  for (const collection of SGU_COLLECTIONS) {
    const targetDir = getHarvestPath('SGU', collection.id);
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
      `OAPIF:${collection.url}`,
      '-nln', collection.id,
      '-t_srs', 'EPSG:3006',
      '-overwrite',
      '--config', 'OAPIF_PAGE_SIZE', '5000'
    ];

    console.log(`   - Downloading via ogr2ogr...`);
    const result = spawnSync(OGR2OGR_PATH, ogrArgs, { stdio: 'inherit' });

    if (result.status !== 0) {
      console.error(`   ❌ Failed to download ${collection.id}`);
      continue;
    }

    console.log(`   - Generating manifest and checksums...`);
    await createManifest(rawDir, {
      provider: 'SGU',
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
