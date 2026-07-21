/**
 * Targeted import: VISS vattenforekomster + SMED belastning vatten (+ LST vattenskydd).
 * Now follows Mimers Brunn: Imports from LOCAL HARVESTED GPKGs.
 * Run: npx dotenv -e .env -- tsx scripts/import/import-viss-water.ts
 */
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PATHS } from './config/mimersBrunn';

dotenv.config();

const prisma = new PrismaClient();
const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const TARGET_SRS = 'EPSG:3006';

const TARGET_ORDER = [
  { id: 'viss_vattenforekomster', provider: 'VISS', table: 'viss.vattenforekomster' },
  { id: 'smed_belastning_vatten', provider: 'SMED', table: 'smed.belastning_vatten' },
  { id: 'lst_vattenskydd', provider: 'LST', table: 'lst.vattenskydd' }
] as const;

async function findLatestHarvest(provider: string, dataset: string): Promise<string | null> {
  const datasetDir = path.join(PATHS.DATA, provider, dataset);
  if (!fs.existsSync(datasetDir)) return null;
  
  const harvests = fs.readdirSync(datasetDir).sort().reverse();
  for (const h of harvests) {
    const gpkgPath = path.join(datasetDir, h, 'raw', `${dataset}.gpkg`);
    if (fs.existsSync(gpkgPath)) return gpkgPath;
  }
  return null;
}

async function importLayer(item: (typeof TARGET_ORDER)[number]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL saknas');

  const url = new URL(databaseUrl);
  const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;
  
  const schema = item.table.split('.')[0];
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

  const sourcePath = await findLatestHarvest(item.provider, item.id);
  if (!sourcePath) {
    throw new Error(`Ingen skördad data hittades för ${item.id} i Master Archive. Kör harvest-viss-to-master.ts först.`);
  }

  console.log(`\nImporting ${item.id} (Local Archive) -> ${item.table}`);
  console.log(`Source: ${sourcePath}`);

  const pgArgs = [
    '-f', 'PostgreSQL',
    pgConn,
    sourcePath,
    '-nln', item.table,
    '-overwrite',
    '-skipfailures',
    '-lco', 'GEOMETRY_NAME=geom',
    '-lco', 'SPATIAL_INDEX=GIST',
    '-lco', `SCHEMA=${schema}`,
    '-t_srs', TARGET_SRS,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ogr2ogr failed for ${item.id} with code ${code}`));
    });
  });
}

async function main() {
  const results: Array<{ id: string; ok: boolean; rows?: string; error?: string }> = [];
  for (const item of TARGET_ORDER) {
    try {
      await importLayer(item);
      const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM ${item.table}`,
      );
      results.push({ id: item.id, ok: true, rows: String(count[0]?.n ?? 0) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed ${item.id}: ${message}`);
      results.push({ id: item.id, ok: false, error: message });
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    if (r.ok) console.log(`${r.id}: OK (${r.rows} rows)`);
    else console.log(`${r.id}: FAIL - ${r.error}`);
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
