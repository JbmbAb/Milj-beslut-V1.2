import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import { PLATFORM_COLLECTIONS } from './platform-datasources';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const FETCH_TIMEOUT_MS = 120000; // 2 minutes
const DOWNLOAD_DIR = './storage/ingest/platform-downloads';
const DOWNLOAD_FIRST = process.argv.includes('--download-first');
// Keep downloaded GPKG files after import? Pass --keep-downloads to preserve.
const KEEP_DOWNLOADS = process.argv.includes('--keep-downloads');
const MAX_CONCURRENT_IMPORTS = 4; // Enforced via semaphore below

/** Simple semaphore so at most MAX_CONCURRENT_IMPORTS run in parallel. */
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;
  constructor(private readonly limit: number) {}
  acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((res) => this.queue.push(res));
  }
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) { this.running++; next(); }
  }
}

// Define the target coordinate reference system (SRS) for all imported data.
// EPSG:3006 (SWEREF 99 TM) is the standard for Swedish national data.
const TARGET_SRS = 'EPSG:3006';

function formatElapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

async function runImport() {
  const importStart = Date.now();
  console.log(`\n🚀 STARTING MASSIVE CROSS-AUTHORITY BULK IMPORT`);
  console.log(`====================================================`);
  console.log(`   Mode: ${DOWNLOAD_FIRST ? 'Download-first (GPKG)' : 'Stream direct'}`);
  console.log(`   Concurrency limit: ${MAX_CONCURRENT_IMPORTS}`);
  console.log(`   Keep downloads: ${KEEP_DOWNLOADS}`);
  console.log();

  const url = new URL(DATABASE_URL);
  const dbname = url.pathname.slice(1);
  const host = url.hostname;
  const user = url.username;
  const password = url.password;
  const port = url.port || '5432';
  const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

  // Tune PostgreSQL session for bulk loading (async WAL, high maintenance mem)
  console.log('⚙️  Applying PostgreSQL bulk-import session settings...');
  await prisma.$executeRawUnsafe(`SET synchronous_commit = off`);
  await prisma.$executeRawUnsafe(`SET maintenance_work_mem = '4GB'`);
  await prisma.$executeRawUnsafe(`SET work_mem = '256MB'`);
  await prisma.$executeRawUnsafe(`SET max_parallel_maintenance_workers = 4`);
  console.log('   ✅ Session tuned');

  // Get Lantmäteriet Token if needed
  let lmToken = '';
  if (PLATFORM_COLLECTIONS.some((c) => 'auth' in c && c.auth === 'lm')) {
    try {
      const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
      const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;

      if (!consumerKey || !consumerSecret) {
        throw new Error(
          'LANTMATERIET_CONSUMER_KEY and LANTMATERIET_CONSUMER_SECRET must be set in .env file.',
        );
      }

      console.log('🔑 Fetching Lantmäteriet access token...');
      const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
      const res = await fetch('https://api.lantmateriet.se/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=ogc_api_topografi_read ogc_api_fastighetsindelning_read',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`Failed to get LM token: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as any;
      lmToken = data.access_token;
    } catch (e) {
      console.error('❌ Critical error: Could not obtain Lantmäteriet token. Aborting.', e);
      process.exit(1);
    }
  }

  const runOgr = (args: string[], processId: string, extraEnv?: Record<string, string>) => {
    return new Promise<void>((resolve, reject) => {
      const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
      const process = spawn(OGR2OGR_PATH, args, { stdio: 'pipe', shell: false, env });
      let stderr = '';
      process.stderr.on('data', (data) => (stderr += data.toString()));
      process.stdout.on('data', (data) => console.log(`[${processId}] ${data.toString().trim()}`));
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ogr2ogr exited with code ${code}. Stderr: ${stderr}`));
        }
      });
    });
  };

  const processItem = async (item: (typeof PLATFORM_COLLECTIONS)[number]) => {
    const itemStart = Date.now();
    console.log(`\n📦 Processing: ${item.id} -> ${item.table}`);

    if ('auth' in item && item.auth === 'lm' && !lmToken) {
      console.log(`   ⚠️ Skipping ${item.id} (no LM token)`);
      return;
    }

    const schema = item.table.split('.')[0];
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);

    let sourcePath: string;
    const sourceFlags: string[] = [];

    if ('filePath' in item && item.filePath) {
      if (!fs.existsSync(item.filePath)) {
        throw new Error(`File not found: ${item.filePath}`);
      }
      sourcePath = item.filePath;
      if ('layerName' in item && item.layerName) {
        sourceFlags.push(item.layerName);
      }
    } else if ('url' in item && item.url) {
      const sourceType = 'type' in item && item.type === 'WFS' ? 'WFS' : 'OAPIF';
      sourcePath = `${sourceType}:${item.url}`;
      if ('featureType' in item && item.featureType) {
        sourceFlags.push(item.featureType);
      }
    } else {
      throw new Error('No url or filePath provided');
    }

    // Pass LM Bearer token via environment variable (more reliable than --config for OAPIF)
    const lmEnv: Record<string, string> | undefined =
      'auth' in item && item.auth === 'lm'
        ? { GDAL_HTTP_HEADERS: `Authorization: Bearer ${lmToken}` }
        : undefined;

    if (DOWNLOAD_FIRST && 'url' in item) {
      console.log(`   - Downloading ${item.id} to local GPKG first...`);
      if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      }
      const downloadPath = `${DOWNLOAD_DIR}/${item.id}.gpkg`;
      const downloadArgs = [
        '-f', 'GPKG',
        downloadPath,
        sourcePath,
        ...sourceFlags,
        '-overwrite',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-gt', '500000',
        '--config', 'OAPIF_PAGE_SIZE', '5000',
        '--config', 'GDAL_CACHEMAX', '2048',
      ].filter(Boolean);

      await runOgr(downloadArgs, `${item.id}-download`, lmEnv);
      const stat = fs.statSync(downloadPath);
      const mb = (stat.size / 1024 / 1024).toFixed(1);
      console.log(`   - Download complete for ${item.id}: ${downloadPath} (${mb} MB, ${formatElapsed(itemStart)})`);
      sourcePath = downloadPath;
      sourceFlags.length = 0;
    }

    const isFileBased = !sourcePath.startsWith('OAPIF:') && !sourcePath.startsWith('WFS:');
    const pgArgs = [
      '-f', 'PostgreSQL',
      pgConn,
      sourcePath,
      ...sourceFlags,
      '-nln', item.table,
      '-overwrite',
      '-gt', isFileBased ? '500000' : '65536',
      '-nlt', 'PROMOTE_TO_MULTI',
      '-lco', 'GEOMETRY_NAME=geom',
      '-lco', 'SPATIAL_INDEX=NONE',
      '-lco', 'UNLOGGED=YES',
      '--config', 'PG_USE_COPY', 'YES',
      '--config', 'GDAL_CACHEMAX', '2048',
      '-t_srs', TARGET_SRS,
      ...(isFileBased ? [] : ['--config', 'OAPIF_PAGE_SIZE', '5000']),
    ].filter(Boolean);

    if (sourcePath.endsWith('.shp')) {
      pgArgs.push('-lco', 'ENCODING=UTF-8', '--config', 'SHAPE_ENCODING', 'LATIN1');
    }

    console.log(`   - Streaming into PostgreSQL for ${item.id} (UNLOGGED, COPY mode)...`);
    await runOgr(pgArgs, item.id, isFileBased ? undefined : lmEnv);

    // Convert UNLOGGED -> LOGGED immediately after this table finishes
    // (defers durability cost but preserves data once WAL-logged)
    console.log(`   - Converting ${item.table} to LOGGED...`);
    await prisma.$executeRawUnsafe(`ALTER TABLE ${item.table} SET LOGGED;`);

    // Clean up raw GPKG unless user passed --keep-downloads
    if (DOWNLOAD_FIRST && !KEEP_DOWNLOADS && 'url' in item) {
      const gpkgPath = `${DOWNLOAD_DIR}/${item.id}.gpkg`;
      if (fs.existsSync(gpkgPath)) {
        fs.unlinkSync(gpkgPath);
        console.log(`   - Deleted intermediate GPKG: ${gpkgPath}`);
      }
    }

    console.log(`   ✅ Completed ${item.id} (${formatElapsed(itemStart)})`);
  };

  const sem = new Semaphore(MAX_CONCURRENT_IMPORTS);

  const importPromises = PLATFORM_COLLECTIONS.map((item) =>
    sem.acquire().then(() =>
      processItem(item)
        .catch((err) => {
          console.error(`\n   ❌ FAILED ${item.id}:`, err instanceof Error ? err.message : err);
          return Promise.reject(err);
        })
        .finally(() => sem.release()),
    ),
  );

  const results = await Promise.allSettled(importPromises);
  const failedCount = results.filter((r) => r.status === 'rejected').length;
  const successCount = PLATFORM_COLLECTIONS.length - failedCount;

  // Build spatial indexes on all successfully imported tables at the end,
  // with high maintenance_work_mem already set for the session.
  if (successCount > 0) {
    console.log(`\n🔧 Building spatial indexes (parallel, maintenance_work_mem=4GB)...`);
    const idxStart = Date.now();
    const successfulTables = PLATFORM_COLLECTIONS
      .filter((_, i) => results[i].status === 'fulfilled')
      .map((item) => item.table);

    for (const table of successfulTables) {
      const idxName = `${table.replace('.', '_')}_geom_idx`;
      try {
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS ${idxName} ON ${table} USING GIST (geom) WITH (fillfactor=80);`,
        );
        console.log(`   ✅ Index: ${idxName}`);
      } catch (e) {
        console.warn(`   ⚠️  Index failed for ${table}:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`   Index build done (${formatElapsed(idxStart)})`);

    // Run VACUUM ANALYZE after all indexes are created
    console.log(`\n🧹 Running VACUUM ANALYZE on all imported tables...`);
    const vacStart = Date.now();
    for (const table of successfulTables) {
      try {
        await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${table};`);
        console.log(`   ✅ VACUUM: ${table}`);
      } catch (e) {
        console.warn(`   ⚠️  VACUUM failed for ${table}:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`   VACUUM done (${formatElapsed(vacStart)})`);
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`ALL IMPORTS FINISHED (total: ${formatElapsed(importStart)})`);
  console.log(`   Collections: ${PLATFORM_COLLECTIONS.length}`);
  console.log(`   Successful:  ${successCount}`);
  console.log(`   Failed:      ${failedCount}`);
  if (failedCount > 0) {
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PLATFORM_COLLECTIONS[i].id : null))
      .filter(Boolean);
    console.log(`   Failed IDs:  ${failed.join(', ')}`);
  }

  await prisma.$disconnect();
  if (failedCount > 0) {
    process.exit(1);
  }
}

runImport();
