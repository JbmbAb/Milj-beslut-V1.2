/**
 * Special script to import identified missing vector data from Downloads.
 * Run: npx dotenv -e .env -- tsx scripts/import/import-downloads-vector.ts
 */
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const DOWNLOAD_DIR = 'C:\\Users\\jimmy\\Downloads';

const IMPORTS = [
  {
    id: 'svar_avrinningsomraden',
    file: path.join(DOWNLOAD_DIR, 'SVARO_2016.zip'),
    layer: 'SVARO_2016',
    table: 'public.env_svar_avrinningsomraden',
    sql: 'SELECT AU_CD as aro_id, AREAL as areal, VERSION as version FROM SVARO_2016'
  },
  {
    id: 'msb_flood_risk',
    file: path.join(DOWNLOAD_DIR, 'InspireMSB_APSFR.zip'),
    layer: 'InspireMSB_APSFR',
    table: 'env.msb_flood_risk_apsfr',
  },
  {
    id: 'sgu_geological_interest_point',
    file: path.join(DOWNLOAD_DIR, 'geologiskt-intressanta-platser.gpkg'),
    layer: 'geoplats_punkt',
    table: 'env.sgu_geological_interest_point',
  },
  {
    id: 'sgu_geological_interest_poly',
    file: path.join(DOWNLOAD_DIR, 'geologiskt-intressanta-platser.gpkg'),
    layer: 'geoplats_yta',
    table: 'env.sgu_geological_interest_poly',
  },
  {
    id: 'svar_vattenomraden',
    file: path.join(DOWNLOAD_DIR, 'VARO_2016.zip'),
    layer: 'VARO_2016',
    table: 'env.svar_vattenomraden_2016',
  }
];

async function runImport() {
  console.log(`\n🚀 IMPORTING VECTOR DATA FROM DOWNLOADS`);
  console.log(`=========================================`);

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  for (const item of IMPORTS) {
    console.log(`\n📦 Processing: ${item.id} -> ${item.table}`);
    
    let source = item.file;
    if (source.endsWith('.zip')) {
        source = `/vsizip/${source}`;
    }

    if (!fs.existsSync(item.file)) {
        console.warn(`   ⚠️ Skip: File not found: ${item.file}`);
        continue;
    }

    try {
      const schema = item.table.split('.')[0];
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

      const args = [
        '-f', 'PostgreSQL',
        pgConn,
        source,
      ];

      if (item.sql) {
          args.push('-sql', item.sql);
      } else {
          args.push(item.layer);
      }

      args.push(
        '-nln', item.table,
        '-overwrite',
        '-gt', '65536',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-lco', 'GEOMETRY_NAME=geom',
        '-lco', 'SPATIAL_INDEX=NONE',
        '-t_srs', 'EPSG:3006'
      );

      console.log(`   - Running ogr2ogr import...`);
      const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
      
      if (result.status !== 0) {
        throw new Error(`ogr2ogr failed with status ${result.status}`);
      }

      console.log(`   - Building spatial index...`);
      const idxName = `${item.table.replace('.', '_')}_geom_idx`;
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${idxName} ON ${item.table} USING GIST (geom);`,
      );
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${item.table};`);

      console.log(`   ✅ Completed ${item.id}`);
    } catch (err) {
      console.error(`   ❌ Failed ${item.id}:`, err);
    }
  }

  console.log(`\nIMPORT FINISHED.`);
  await prisma.$disconnect();
}

runImport();
