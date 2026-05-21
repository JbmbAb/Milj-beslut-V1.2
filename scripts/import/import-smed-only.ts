import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { PLATFORM_COLLECTIONS } from './platform-datasources';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const TARGET_SRS = 'EPSG:3006';

async function runSmedImport() {
  console.log(`\n🌊 STARTING TARGETED SMED & VISS IMPORT`);
  console.log(`==========================================`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  // Filter for SLU and Skogsstyrelsen environmental layers (Skipping LST/SMHI due to downtime)
  const targetIds = [
    'slu_artobservationer',
    'skogsstyrelsen_nyckelbiotoper',
    'skogsstyrelsen_naturvarden'
  ];
  
  const smedCollections = PLATFORM_COLLECTIONS.filter(c => targetIds.includes(c.id));

  if (smedCollections.length === 0) {
    console.error('❌ No SMED/VISS collections found in platform-datasources.ts');
    return;
  }

  for (const item of smedCollections) {
    console.log(`\n📦 Importing: ${item.id} -> ${item.table}`);
    
    const schema = item.table.split('.')[0];
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

    let sourcePath = '';
    const sourceFlags: string[] = [];

    if ('url' in item && item.url) {
      const sourceType = 'type' in item && item.type === 'WFS' ? 'WFS' : 'OAPIF';
      sourcePath = `${sourceType}:${item.url}`;
      if ('featureType' in item && item.featureType) {
        sourceFlags.push(String(item.featureType));
      }
    }

    const pgArgs = [
      '-f', 'PostgreSQL', pgConn,
      sourcePath, ...sourceFlags,
      '-nln', item.table,
      '-overwrite',
      '-skipfailures',
      '-limit', '1000',
      '-lco', 'GEOMETRY_NAME=geom',
      '-lco', 'SPATIAL_INDEX=GIST',
      '-t_srs', TARGET_SRS,
      '-lco', 'SCHEMA=' + schema,
    ].filter(Boolean);

    // Add VISS API Key if available
    const env = { ...process.env };
    if (item.id.includes('viss') || item.id.includes('smed')) {
      const vissKey = process.env.VISS_API_KEY;
      if (vissKey) {
        // ogr2ogr WFS driver can use --config GDAL_HTTP_HEADERS
        pgArgs.push('--config', 'GDAL_HTTP_HEADERS', `apikey: ${vissKey}`);
      }
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false, env });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ogr2ogr failed with code ${code}`));
      });
    });

    console.log(`   ✅ Success: ${item.id}`);
  }

  console.log(`\n✅ ALL SMED/VISS IMPORTS FINISHED`);
  await prisma.$disconnect();
}

runSmedImport().catch(console.error);
