import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import type { SguBulkImportJob, SguGeometryHint } from '../../server/datasources/sguBulkImportManifest';

export const OGR2OGR_PATH = process.env.OGR2OGR_PATH ?? 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const TARGET_SRS = 'EPSG:3006';

export function defaultSguDownloadDir(): string {
  return process.env.SGU_DOWNLOAD_DIR ?? 'C:\\Users\\jimmy\\Downloads';
}

export function resolveSguSourcePath(downloadDir: string, job: SguBulkImportJob): string {
  const zipAbs = path.resolve(downloadDir, job.zipFile).replace(/\\/g, '/');
  const inner = job.innerGpkg.replace(/\\/g, '/');
  return `/vsizip/${zipAbs}/${inner}`;
}

export function buildPgConn(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1);
  const port = url.port || '5432';
  const options = '-c synchronous_commit=off -c work_mem=256MB -c statement_timeout=28800000';
  return (
    `PG:dbname='${dbName}' host='${url.hostname}' user='${url.username}' ` +
    `password='${url.password}' port='${port}' options='${options}'`
  );
}

export function buildOgr2ogrEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GDAL_CACHEMAX: '2048',
    PGOPTIONS: '-c synchronous_commit=off -c work_mem=256MB -c statement_timeout=28800000',
  };
}

function groupSize(geometry: SguGeometryHint): string {
  return geometry === 'polygon' ? '500000' : '65536';
}

export function formatElapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000);
  return s >= 3600
    ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : s >= 60
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${s}s`;
}

export async function applyBulkSessionSettings(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`SET synchronous_commit = off`);
  await prisma.$executeRawUnsafe(`SET maintenance_work_mem = '4GB'`);
  await prisma.$executeRawUnsafe(`SET work_mem = '256MB'`);
  await prisma.$executeRawUnsafe(`SET max_parallel_maintenance_workers = 4`);
  await prisma.$executeRawUnsafe(`SET jit = off`);
}

export async function resetBulkSessionSettings(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`RESET synchronous_commit`);
  await prisma.$executeRawUnsafe(`RESET maintenance_work_mem`);
  await prisma.$executeRawUnsafe(`RESET work_mem`);
  await prisma.$executeRawUnsafe(`RESET max_parallel_maintenance_workers`);
  await prisma.$executeRawUnsafe(`RESET jit`);
}

async function dropTableIndexes(prisma: PrismaClient, tableRef: string): Promise<void> {
  const [schema, table] = tableRef.split('.');
  const indexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${table}' AND indexname NOT LIKE '%_pkey'`,
  );
  for (const idx of indexes) {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${schema}"."${idx.indexname}"`);
  }
}

export async function prepareTableForBulkLoad(prisma: PrismaClient, tableRef: string): Promise<void> {
  const schema = tableRef.split('.')[0];
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await dropTableIndexes(prisma, tableRef);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${tableRef} CASCADE`);
}

export function runOgr2ogr(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(OGR2OGR_PATH, args, {
      stdio: 'inherit',
      shell: false,
      env: buildOgr2ogrEnv(),
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ogr2ogr failed with code ${code}`));
    });
  });
}

export async function tableHasRows(prisma: PrismaClient, tableRef: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM ${tableRef}`,
    );
    return (rows[0]?.n ?? 0n) > 0n;
  } catch {
    return false;
  }
}

/** Tabeller avbrutna mitt i ogr2ogr (UNLOGGED, aldrig SET LOGGED). */
export async function findInterruptedSguTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ table: string }[]>(
    `SELECT n.nspname || '.' || c.relname AS "table"
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'env'
       AND c.relname LIKE 'sgu_%'
       AND c.relkind = 'r'
       AND c.relpersistence = 'u'`,
  );
  return rows.map((r) => r.table);
}

export async function dropInterruptedSguTables(prisma: PrismaClient): Promise<string[]> {
  const tables = await findInterruptedSguTables(prisma);
  const dropped: string[] = [];
  for (const table of tables) {
    const relname = table.split('.').pop() ?? '';
    if (relname.endsWith('_seq')) continue;
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
    dropped.push(table);
  }
  return dropped;
}

const PARTIAL_TABLE_THRESHOLDS: Array<{ table: string; minRows: bigint }> = [
  { table: 'env.sgu_permeability', minRows: 2_500_000n },
];

/** LOGGED men avbruten load (t.ex. krasch efter ogr2ogr men före fullständig batch). */
export async function dropSuspectPartialTables(prisma: PrismaClient): Promise<string[]> {
  const dropped: string[] = [];
  for (const { table, minRows } of PARTIAL_TABLE_THRESHOLDS) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM ${table}`,
      );
      const n = rows[0]?.n ?? 0n;
      if (n > 0n && n < minRows) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
        dropped.push(`${table} (${n.toLocaleString('sv-SE')} rader)`);
      }
    } catch {
      // table missing
    }
  }
  return dropped;
}

export async function importSguJob(
  prisma: PrismaClient,
  pgConn: string,
  downloadDir: string,
  job: SguBulkImportJob,
): Promise<bigint> {
  const zipPath = path.join(downloadDir, job.zipFile);
  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP saknas: ${zipPath}`);
  }

  const sourcePath = resolveSguSourcePath(downloadDir, job);
  const schema = job.table.split('.')[0];

  await prepareTableForBulkLoad(prisma, job.table);

  const args = [
    '-f',
    'PostgreSQL',
    pgConn,
    sourcePath,
    job.layer,
    '-nln',
    job.table,
    '-overwrite',
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-lco',
    `SCHEMA=${schema}`,
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SPATIAL_INDEX=NONE',
    '-lco',
    'UNLOGGED=YES',
    '-t_srs',
    TARGET_SRS,
    '--config',
    'PG_USE_COPY',
    'YES',
    '--config',
    'GDAL_CACHEMAX',
    '2048',
  ];

  // Punktlager: hoppa över ogiltiga reprojektioner (markgeokemi m.m.). -gt + -skipfailures funkar inte i alla GDAL-builds.
  if (job.geometry === 'point') {
    args.push('-skipfailures');
  } else {
    args.push('-gt', groupSize(job.geometry));
  }

  await runOgr2ogr(args);

  await prisma.$executeRawUnsafe(`ALTER TABLE ${job.table} SET LOGGED`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${job.table} SET (autovacuum_enabled = true)`);

  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM ${job.table}`,
  );
  return rows[0]?.n ?? 0n;
}

export async function buildSpatialIndex(prisma: PrismaClient, tableRef: string): Promise<void> {
  const idxName = `${tableRef.replace(/\./g, '_')}_geom_gist`;
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${idxName}`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX ${idxName} ON ${tableRef} USING GIST (geom) WITH (fillfactor=90)`,
  );
}

export async function vacuumAnalyzeTable(prisma: PrismaClient, tableRef: string): Promise<void> {
  await prisma.$executeRawUnsafe(`ANALYZE ${tableRef}`);
  await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${tableRef}`);
}
