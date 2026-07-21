/**
 * Targeted import: SMHI SVAR 2022 huvudavrinningsområden (111 polygoner).
 * Run: npx dotenv -e .env -- tsx scripts/import/import-smhi-huvudavrinningsomraden.ts
 */
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const WFS_URL =
  'https://opendata-view.smhi.se/SMHI_vatten_RiverBasin/HY.PhysicalWaters.Catchments/wfs';
const FEATURE_TYPE = 'SMHI_vatten_RiverBasin:HY.PhysicalWaters.Catchments';
const TABLE = 'hydro.huvudavrinningsomraden';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const url = new URL(databaseUrl);
  const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;

  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS hydro;');

  console.log(`\nImporting SMHI huvudavrinningsområden -> ${TABLE}`);

  const pgArgs = [
    '-f',
    'PostgreSQL',
    pgConn,
    `WFS:${WFS_URL}`,
    FEATURE_TYPE,
    '-nln',
    TABLE,
    '-overwrite',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SPATIAL_INDEX=GIST',
    '-lco',
    'SCHEMA=hydro',
    '-t_srs',
    'EPSG:3006',
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ogr2ogr failed with code ${code}`));
    });
  });

  const count = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM hydro.huvudavrinningsomraden
  `;
  console.log(`\nDone. Rows in ${TABLE}: ${count[0]?.n ?? 0}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
