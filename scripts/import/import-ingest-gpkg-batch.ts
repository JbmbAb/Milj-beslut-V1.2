/**
 * Batch-import av .gpkg under ingest-arkiv dataportal-env till stage.* (ogr2ogr).
 * Kör i begränsade batchar för att undvika disk/memory-problem.
 *
 * Run:
 *   npx dotenv -e .env -- tsx scripts/import/import-ingest-gpkg-batch.ts --limit=50
 *   npx dotenv -e .env -- tsx scripts/import/import-ingest-gpkg-batch.ts --offset=50 --limit=50
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR = process.env.OGR2OGR_PATH ?? 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const INGEST_ROOT =
  process.env.INGEST_GPKG_ROOT ??
  'D:\\ingest-arkiv-2026-03-29\\dataportal-env';

function readNumArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  const n = Number(hit.slice(prefix.length));
  return Number.isFinite(n) ? n : fallback;
}

function buildPgConn(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  const db = u.pathname.replace(/^\//, '');
  return `PG:dbname=${db} host=${u.hostname} port=${u.port || '5432'} user=${u.username} password=${u.password}`;
}

function sanitizeTableName(relPath: string): string {
  const base = relPath
    .replace(/\.gpkg$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `ingest_${base}`.slice(0, 55);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL saknas');

  const limit = readNumArg('limit', 30);
  const offset = readNumArg('offset', 0);
  const pgConn = buildPgConn(databaseUrl);

  if (!fs.existsSync(INGEST_ROOT)) {
    throw new Error(`INGEST_ROOT saknas: ${INGEST_ROOT}`);
  }

  const all = fs
    .readdirSync(INGEST_ROOT, { recursive: true })
    .filter((f): f is string => typeof f === 'string' && f.toLowerCase().endsWith('.gpkg'))
    .map((f) => path.join(INGEST_ROOT, f))
    .sort();

  const slice = all.slice(offset, offset + limit);
  console.log(`\nIngest GPKG batch: offset=${offset} limit=${limit} (totalt ${all.length} gpkg)`);

  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS stage`);

  let ok = 0;
  let fail = 0;

  for (const gpkg of slice) {
    const rel = path.relative(INGEST_ROOT, gpkg);
    const table = `stage.${sanitizeTableName(rel)}`;
    console.log(`\n→ ${rel} → ${table}`);

    const args = [
      '-f',
      'PostgreSQL',
      pgConn,
      gpkg,
      '-nln',
      table,
      '-nlt',
      'PROMOTE_TO_MULTI',
      '-t_srs',
      'EPSG:3006',
      '-lco',
      'GEOMETRY_NAME=wkb_geometry',
      '--config',
      'PG_USE_COPY',
      'YES',
      '-skipfailures',
      '-overwrite',
    ];

    const result = spawnSync(OGR2OGR, args, { stdio: 'inherit' });
    if (result.status === 0) ok++;
    else {
      fail++;
      console.error(`   ✗ ${rel}`);
    }
  }

  console.log(`\nBatch klar: ${ok} OK, ${fail} misslyckade`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
