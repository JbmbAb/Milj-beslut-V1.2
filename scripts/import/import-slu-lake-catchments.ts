/**
 * Import SLU sjöavrinningsområden + kemisammanfattning (DOI 10.5878/85cj-nv56).
 * Källa: storage/ingest/slu/lake-catchments/ (eller zip från Downloads).
 *
 * Run: npx dotenv -e .env -- tsx scripts/import/import-slu-lake-catchments.ts
 */
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDataDir = path.join(repoRoot, 'storage/ingest/slu/lake-catchments/2025-256-2/data');
const CATCHMENT_TABLE = 'hydro.slu_lake_catchment';
const CHARACTERISTICS_TABLE = 'hydro.slu_lake_characteristics';

function runOgr(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(OGR2OGR_PATH, args, { stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ogr2ogr failed with code ${code}`));
    });
  });
}

function ensureShapefiles(dataDir: string): { slsShp: string; trendShp: string } {
  const slsZip = path.join(dataDir, 'SLS.zip');
  const trendZip = path.join(dataDir, 'trend.zip');
  const slsShp = path.join(dataDir, 'SLS', 'SLS.shp');
  const trendShp = path.join(dataDir, 'trend.shp');

  if (!fs.existsSync(slsShp) && fs.existsSync(slsZip)) {
    execSync(`tar -xf "${slsZip}" -C "${dataDir}"`, { stdio: 'pipe' });
  }
  if (!fs.existsSync(trendShp) && fs.existsSync(trendZip)) {
    execSync(`tar -xf "${trendZip}" -C "${dataDir}"`, { stdio: 'pipe' });
  }
  if (!fs.existsSync(slsShp)) {
    throw new Error(`SLS shapefile saknas: ${slsShp}`);
  }
  if (!fs.existsSync(trendShp)) {
    throw new Error(`Trend shapefile saknas: ${trendShp}`);
  }
  return { slsShp, trendShp };
}

async function main() {
  const dataDir = process.argv[2] ?? defaultDataDir;
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Datakatalog saknas: ${dataDir}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const url = new URL(databaseUrl);
  const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;

  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS hydro;');

  const { slsShp, trendShp } = ensureShapefiles(dataDir);

  console.log(`\nImporting SLU catchments -> ${CATCHMENT_TABLE}`);
  console.log(`   SLS: ${slsShp}`);
  await runOgr([
    '-f',
    'PostgreSQL',
    pgConn,
    slsShp,
    '-dialect',
    'SQLite',
    '-sql',
    `SELECT mvm_id, Name AS lake_name, Shape_Area AS area_m2, 'SLS' AS monitor_program FROM SLS`,
    '-nln',
    CATCHMENT_TABLE,
    '-overwrite',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SPATIAL_INDEX=GIST',
    '-lco',
    'SCHEMA=hydro',
    '-t_srs',
    'EPSG:3006',
  ]);

  console.log(`   Trend: ${trendShp}`);
  await runOgr([
    '-f',
    'PostgreSQL',
    pgConn,
    trendShp,
    '-dialect',
    'SQLite',
    '-sql',
    `SELECT mvm_id, Name AS lake_name, Shape_Area AS area_m2, 'trend' AS monitor_program FROM trend`,
    '-nln',
    CATCHMENT_TABLE,
    '-append',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SCHEMA=hydro',
    '-t_srs',
    'EPSG:3006',
  ]);

  const slsCsv = path.join(dataDir, 'characteristics_SLS.csv');
  const trendCsv = path.join(dataDir, 'characteristics_trend.csv');
  if (fs.existsSync(slsCsv) && fs.existsSync(trendCsv)) {
    console.log(`\nImporting SLU characteristics -> ${CHARACTERISTICS_TABLE}`);
    const charSql = `
      SELECT
        CAST(mvm_id AS TEXT) AS mvm_id,
        stationname,
        pH_start,
        pH_change,
        totn_start,
        totn_change,
        totp_start,
        totp_change,
        toc_start,
        toc_change,
        ANC_start,
        ANC_change,
        lat,
        lon
    `.replace(/\s+/g, ' ').trim();

    await runOgr([
      '-f',
      'PostgreSQL',
      pgConn,
      slsCsv,
      '-dialect',
      'SQLite',
      '-sql',
      `${charSql}, 'SLS' AS monitor_program FROM characteristics_SLS`,
      '-nln',
      CHARACTERISTICS_TABLE,
      '-overwrite',
      '-lco',
      'SCHEMA=hydro',
    ]);

    await runOgr([
      '-f',
      'PostgreSQL',
      pgConn,
      trendCsv,
      '-dialect',
      'SQLite',
      '-sql',
      `${charSql}, 'trend' AS monitor_program FROM characteristics_trend`,
      '-nln',
      CHARACTERISTICS_TABLE,
      '-append',
      '-lco',
      'SCHEMA=hydro',
    ]);
  }

  const catchmentCount = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM ${CATCHMENT_TABLE}`,
  );
  const charCount = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM ${CHARACTERISTICS_TABLE}`,
  );

  console.log(`\nDone. ${CATCHMENT_TABLE}: ${catchmentCount[0]?.n ?? 0} rader`);
  console.log(`      ${CHARACTERISTICS_TABLE}: ${charCount[0]?.n ?? 0} rader`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
