/**
 * Import RAA INSPRE Buildings – ruiner (BU.Ruins.gml) till env.raa_building_ruin.
 * Run: npx dotenv -e .env -- tsx scripts/import/import-raa-building-ruins.ts [path-to-gml]
 */
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const DEFAULT_GML = path.join(process.env.USERPROFILE ?? '', 'Downloads', 'BU.Ruins.gml');
const TABLE = 'env.raa_building_ruin';

async function main() {
  const gmlPath = process.argv[2] ?? DEFAULT_GML;
  if (!fs.existsSync(gmlPath)) {
    throw new Error(`GML-fil saknas: ${gmlPath}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const url = new URL(databaseUrl);
  const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;

  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS env;');

  console.log(`\nImporting RAA building ruins -> ${TABLE}`);
  console.log(`   Source: ${gmlPath}`);

  const pgArgs = [
    '-f',
    'PostgreSQL',
    pgConn,
    gmlPath,
    'Building',
    '-nln',
    TABLE,
    '-overwrite',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SPATIAL_INDEX=GIST',
    '-lco',
    'SCHEMA=env',
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
    SELECT COUNT(*)::bigint AS n FROM env.raa_building_ruin
  `;
  console.log(`\nDone. Rows in ${TABLE}: ${count[0]?.n ?? 0}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
