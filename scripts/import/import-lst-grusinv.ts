/**
 * Import Länsstyrelsen Grusinventering (Lstx.Grusinv) shapefile.
 * Källa: https://ext-dokument.lansstyrelsen.se/gemensamt/geodata/ShapeExport/Lstx.Grusinv.zip
 *
 * Run: npx dotenv -e .env -- tsx scripts/import/import-lst-grusinv.ts
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const TABLE = 'env.lst_grusinventering';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultShp = path.join(repoRoot, 'storage/ingest/lst/Lstx.Grusinv/Lstx.Grusinv.shp');

async function main() {
  const shpPath = process.argv[2] ?? defaultShp;
  if (!fs.existsSync(shpPath)) {
    throw new Error(`Shapefile saknas: ${shpPath}. Ladda ner Lstx.Grusinv.zip först.`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const url = new URL(databaseUrl);
  const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;

  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS env;');

  console.log(`\nImporting LST Grusinv -> ${TABLE}`);
  console.log(`   Source: ${shpPath}`);

  const pgArgs = [
    '-f',
    'PostgreSQL',
    pgConn,
    shpPath,
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
    SELECT COUNT(*)::bigint AS n FROM env.lst_grusinventering
  `;
  console.log(`\nDone. Rows in ${TABLE}: ${count[0]?.n ?? 0}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
