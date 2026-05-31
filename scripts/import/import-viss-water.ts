/**
 * Targeted import: VISS vattenforekomster + SMED belastning vatten (+ LST vattenskydd).
 * Run: npx dotenv -e .env -- tsx scripts/import/import-viss-water.ts
 */
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { PLATFORM_COLLECTIONS } from './platform-datasources';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const TARGET_SRS = 'EPSG:3006';

const TARGET_ORDER = ['viss_vattenforekomster', 'smed_belastning_vatten', 'lst_vattenskydd'] as const;

async function importLayer(item: (typeof PLATFORM_COLLECTIONS)[number]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const url = new URL(databaseUrl);
  const pgConn =
    "PG:dbname='" +
    url.pathname.slice(1) +
    "' host='" +
    url.hostname +
    "' user='" +
    url.username +
    "' password='" +
    url.password +
    "' port='" +
    (url.port || '5432') +
    "'";
  const schema = item.table.split('.')[0];
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS ' + schema + ';');

  if (!('url' in item) || !item.url) {
    throw new Error(item.id + ' saknar url');
  }

  const sourceType = 'type' in item && item.type === 'WFS' ? 'WFS' : 'OAPIF';
  const sourcePath = sourceType + ':' + item.url;
  const sourceFlags: string[] = [];
  if ('featureType' in item && item.featureType) {
    sourceFlags.push(String(item.featureType));
  }

  const vissKey = process.env.VISS_API_KEY;
  const env = { ...process.env };
  if (vissKey && (item.id.includes('viss') || item.id.includes('smed') || item.id.includes('lst'))) {
    env.GDAL_HTTP_HEADERS = 'apikey: ' + vissKey;
  }

  console.log('\nImporting ' + item.id + ' -> ' + item.table);

  const pgArgs = [
    '-f',
    'PostgreSQL',
    pgConn,
    sourcePath,
    ...sourceFlags,
    '-nln',
    item.table,
    '-overwrite',
    '-skipfailures',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SPATIAL_INDEX=GIST',
    '-lco',
    'SCHEMA=' + schema,
    '-t_srs',
    TARGET_SRS,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false, env });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ogr2ogr failed for ' + item.id + ' with code ' + code));
    });
  });
}

async function main() {
  const byId = new Map<(typeof PLATFORM_COLLECTIONS)[number]['id'], (typeof PLATFORM_COLLECTIONS)[number]>(
    PLATFORM_COLLECTIONS.map((c) => [c.id, c]),
  );
  const layers = TARGET_ORDER.map((id) => byId.get(id)).filter(
    Boolean,
  ) as (typeof PLATFORM_COLLECTIONS)[number][];

  const results: Array<{ id: string; ok: boolean; rows?: string; error?: string }> = [];
  for (const item of layers) {
    try {
      await importLayer(item);
      const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        'SELECT COUNT(*)::bigint AS n FROM ' + item.table,
      );
      results.push({ id: item.id, ok: true, rows: String(count[0]?.n ?? 0) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed ' + item.id + ': ' + message);
      results.push({ id: item.id, ok: false, error: message });
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    if (r.ok) console.log(r.id + ': OK (' + r.rows + ' rows)');
    else console.log(r.id + ': FAIL - ' + r.error);
  }
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
