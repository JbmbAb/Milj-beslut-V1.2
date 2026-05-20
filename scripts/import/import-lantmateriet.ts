import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const COLLECTIONS = [
  {
    id: 'lm_fastighetsytor',
    url: 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradesytor',
    table: 'public.env_registerenhetsomradesytor',
    auth: 'lm',
  },
  {
    id: 'lm_fastighetslinjer',
    url: 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradeslinjer',
    table: 'public.env_registerenhetsomradeslinjer',
    auth: 'lm',
  },
];

const DOWNLOAD_DIR = './storage/ingest/platform-downloads';
const DOWNLOAD_FIRST = process.argv.includes('--download-first');

async function runImport() {
  console.log(`\n🚀 STARTING LANTMÄTERIET IMPORT`);
  console.log(`====================================================`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  // Get Lantmäteriet Token
  let lmToken = '';
  try {
    const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
    const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error('LANTMATERIET_CONSUMER_KEY and LANTMATERIET_CONSUMER_SECRET must be set in .env file.');
    }

    console.log('🔑 Fetching Lantmäteriet access token...');
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenUrl = process.env.LANTMATERIET_TOKEN_URL || 'https://apimanager.lantmateriet.se/oauth2/token';
    const scope = process.env.LANTMATERIET_SCOPE || 'ogc-features:fastighetsindelning.read';
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
    });
    if (!res.ok) {
      throw new Error(`Failed to get LM token: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    lmToken = data.access_token;

    // Write header file for GDAL (GDAL_HTTP_HEADERS env var unreliable on Windows)
    const headerFile = path.resolve('lm_headers.txt');
    fs.writeFileSync(headerFile, `Authorization: Bearer ${lmToken}\r\n`);
    process.env.GDAL_HTTP_HEADER_FILE = headerFile;
  } catch (e) {
    console.error('❌ Critical error: Could not obtain Lantmäteriet token. Aborting.', e);
    process.exit(1);
  }

  for (const item of COLLECTIONS) {
    console.log(`\n📦 Processing: ${item.id} -> ${item.table}`);

    try {
      const schema = item.table.split('.')[0];
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      let sourcePath = `OAPIF:${item.url}`;
      const authHeader = `Authorization: Bearer ${lmToken}`;

      if (DOWNLOAD_FIRST) {
        console.log(`   - Downloading to local file first...`);
        const downloadPath = `${DOWNLOAD_DIR}/${item.id}.gpkg`;

        const args = [
          '--config', 'GDAL_HTTP_HEADER_FILE', path.resolve('lm_headers.txt'),
          '--config', 'OAPIF_PAGE_SIZE', '5000',
          '-f', 'GPKG',
          path.resolve(downloadPath),
          sourcePath,
          '-overwrite',
          '-nlt', 'PROMOTE_TO_MULTI',
        ];

        console.log(`   - Running ogr2ogr download...`);
        const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
        if (result.status !== 0) {
          throw new Error(`ogr2ogr download failed with status ${result.status}`);
        }

        console.log(`   - Download complete: ${downloadPath}`);
        sourcePath = downloadPath;
      }

      const args = [
        '--config', 'GDAL_HTTP_HEADER_FILE', path.resolve('lm_headers.txt'),
        '-f', 'PostgreSQL',
        pgConn,
        sourcePath,
        '-nln', item.table,
        '-overwrite',
        '-gt', '65536',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-lco', 'GEOMETRY_NAME=geom',
        '-lco', 'SPATIAL_INDEX=NONE',
      ];

      console.log(`   - Running ogr2ogr import...`);
      const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`ogr2ogr import failed with status ${result.status}`);
      }

      console.log(`   - Rebuilding spatial index...`);
      const idxName = `${item.table.replace('.', '_')}_geom_idx`;
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${idxName} ON ${item.table} USING GIST (geom);`,
      );
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${item.table};`);

      console.log(`   ✅ Completed ${item.id}`);
    } catch (err) {
      console.error(`   ❌ Failed ${item.id}:`, err);
    }

    // Delay to avoid 429
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log(`\nLANTMÄTERIET IMPORT FINISHED.`);
  await prisma.$disconnect();
}

runImport();
