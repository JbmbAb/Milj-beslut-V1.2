/**
 * @deprecated Sunset 2026-09-01 — use import-librarian-manifest.ts only.
 * See docs/architecture/import-librarian-only-policy.md
 */
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PLATFORM_COLLECTIONS } from './platform-datasources';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const FETCH_TIMEOUT_MS = 120000; // 2 minutes
const OGR_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const OGR_REMOTE_RETRY_ATTEMPTS = 3;
const MIN_VALID_GPKG_BYTES = 128 * 1024; // Ignore known truncated 64KB stubs.
const DOWNLOAD_DIR = './storage/ingest/platform-downloads';
const DOWNLOAD_FIRST = process.argv.includes('--download-first');
const FROM_DOWNLOADED = process.argv.includes('--from-downloaded');
const INCLUDE_DISABLED = process.argv.includes('--include-disabled');
const FORCE_REDOWNLOAD = process.argv.includes('--force-redownload');
const LOCAL_ONLY = process.argv.includes('--local-only');
const ONLY_PREFIXES_ARG = process.argv.find((arg) => arg.startsWith('--only-prefixes='));
const ONLY_PREFIXES = ONLY_PREFIXES_ARG
  ? ONLY_PREFIXES_ARG.split('=')[1]
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
  : [];
// Keep downloaded GPKG files after import? Pass --keep-downloads to preserve.
const KEEP_DOWNLOADS = process.argv.includes('--keep-downloads');
const MAX_CONCURRENT_IMPORTS = 4; // Enforced via semaphore below

function isDisabledSource(item: (typeof PLATFORM_COLLECTIONS)[number]): boolean {
  return 'disabled' in item && item.disabled === true;
}

function isIncludedByPrefix(item: (typeof PLATFORM_COLLECTIONS)[number]): boolean {
  if (ONLY_PREFIXES.length === 0) {
    return true;
  }
  const id = String(item.id).toLowerCase();
  return ONLY_PREFIXES.some((prefix) => id.startsWith(`${prefix}_`) || id === prefix);
}

function isRecoverableLocalGpkgError(message: string): boolean {
  return (
    message.includes('database disk image is malformed') ||
    message.includes('attempt to write a readonly database') ||
    message.includes('Unable to open datasource')
  );
}

function isTransientRemoteOgrError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('recv failure') ||
    normalized.includes('connection was reset') ||
    normalized.includes('unable to open datasource') ||
    normalized.includes('timed out') ||
    normalized.includes('temporarily unavailable')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQuarantineMarkerPath(localDownloadPath: string): string {
  return `${localDownloadPath}.bad`;
}

function isQuarantinedDownloadedFile(localDownloadPath: string): boolean {
  return fs.existsSync(getQuarantineMarkerPath(localDownloadPath));
}

function markDownloadedFileQuarantined(localDownloadPath: string, reason: string): void {
  const markerPath = getQuarantineMarkerPath(localDownloadPath);
  const payload = `quarantinedAt=${new Date().toISOString()}\nreason=${reason}\n`;
  fs.writeFileSync(markerPath, payload, 'utf8');
}

function resolveBestLocalDownloadedPath(sourceId: string): string | null {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    return null;
  }

  const entries = fs
    .readdirSync(DOWNLOAD_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name.startsWith(sourceId) && name.endsWith('.gpkg'));

  if (entries.length === 0) {
    return null;
  }

  const ranked = entries
    .map((name) => {
      const fullPath = path.join(DOWNLOAD_DIR, name);
      const stat = fs.statSync(fullPath);
      const canonicalBonus = name === `${sourceId}.gpkg` ? 1 : 0;
      return { fullPath, size: stat.size, mtimeMs: stat.mtimeMs, canonicalBonus };
    })
    .filter((e) => !isQuarantinedDownloadedFile(e.fullPath))
    .filter((e) => e.size >= MIN_VALID_GPKG_BYTES)
    .sort((a, b) => b.size - a.size || b.canonicalBonus - a.canonicalBonus || b.mtimeMs - a.mtimeMs);

  return ranked.length > 0 ? ranked[0].fullPath : null;
}

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
    if (next) {
      this.running++;
      next();
    }
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
  const skippedLocalOnlyIds: string[] = [];
  const prefixScopedCollections = PLATFORM_COLLECTIONS.filter((item) => isIncludedByPrefix(item));
  const activeCollections = prefixScopedCollections.filter(
    (item) => INCLUDE_DISABLED || !isDisabledSource(item),
  );
  const disabledCollections = prefixScopedCollections.filter((item) => isDisabledSource(item));

  console.log(`\n🚀 STARTING MASSIVE CROSS-AUTHORITY BULK IMPORT`);
  console.log(`====================================================`);
  console.log(`   Mode: ${DOWNLOAD_FIRST ? 'Download-first (GPKG)' : 'Stream direct'}`);
  console.log(`   Concurrency limit: ${MAX_CONCURRENT_IMPORTS}`);
  console.log(`   Keep downloads: ${KEEP_DOWNLOADS}`);
  if (ONLY_PREFIXES.length > 0) {
    console.log(`   Prefix filter: ${ONLY_PREFIXES.join(', ')}`);
  }
  if (INCLUDE_DISABLED) {
    console.log('   Include disabled sources: true');
  }
  if (FORCE_REDOWNLOAD) {
    console.log('   Force redownload: true');
  }
  if (LOCAL_ONLY) {
    console.log('   Local only: true');
  }
  if (disabledCollections.length > 0) {
    console.log(`   Disabled sources: ${disabledCollections.length}`);
    console.log(`   Disabled IDs: ${disabledCollections.map((c) => c.id).join(', ')}`);
  }
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
  if (activeCollections.some((c) => 'auth' in c && c.auth === 'lm')) {
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

  const runOgr = (
    args: string[],
    processId: string,
    extraEnv?: Record<string, string>,
    timeoutMs?: number,
  ) => {
    return new Promise<void>((resolve, reject) => {
      const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
      const childProcess = spawn(OGR2OGR_PATH, args, { stdio: 'pipe', shell: false, env });
      let stderr = '';
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          childProcess.kill();
        }, timeoutMs);
      }

      childProcess.stderr.on('data', (data) => (stderr += data.toString()));
      childProcess.stdout.on('data', (data) => console.log(`[${processId}] ${data.toString().trim()}`));
      childProcess.on('close', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (timedOut) {
          reject(
            new Error(`ogr2ogr timed out after ${Math.round((timeoutMs || 0) / 1000)}s. Stderr: ${stderr}`),
          );
          return;
        }
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
    const localDownloadPath = path.join(DOWNLOAD_DIR, `${item.id}.gpkg`);
    const bestLocalDownloadedPath = resolveBestLocalDownloadedPath(String(item.id));
    let usedExistingDownloadedFile = false;

    if ('filePath' in item && item.filePath) {
      const filePath = String(item.filePath);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      sourcePath = filePath;
      if ('layerName' in item && item.layerName) {
        sourceFlags.push(String(item.layerName));
      }
    } else if ('url' in item && item.url) {
      const sourceType = 'type' in item && item.type === 'WFS' ? 'WFS' : 'OAPIF';
      sourcePath = `${sourceType}:${item.url}`;
      if ('featureType' in item && item.featureType) {
        sourceFlags.push(String(item.featureType));
      }
    } else {
      throw new Error('No url or filePath provided');
    }

    // Pass LM Bearer token via environment variable (more reliable than --config for OAPIF)
    const lmEnv: Record<string, string> | undefined =
      'auth' in item && item.auth === 'lm'
        ? { GDAL_HTTP_HEADERS: `Authorization: Bearer ${lmToken}` }
        : undefined;

    const isRemoteSourcePath = sourcePath.startsWith('OAPIF:') || sourcePath.startsWith('WFS:');

    const downloadToLocal = async (targetPath: string = localDownloadPath) => {
      console.log(`   - Downloading ${item.id} to local GPKG first...`);
      if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      }
      let lastError: unknown;

      for (let attempt = 1; attempt <= OGR_REMOTE_RETRY_ATTEMPTS; attempt++) {
        let effectiveTargetPath = targetPath;
        if (fs.existsSync(effectiveTargetPath) || attempt > 1) {
          effectiveTargetPath = path.join(DOWNLOAD_DIR, `${item.id}-dl-${Date.now()}-${attempt}.gpkg`);
          console.log(`   - Existing target is busy/present, using unique path: ${effectiveTargetPath}`);
        }

        const downloadArgs = [
          '-f',
          'GPKG',
          effectiveTargetPath,
          sourcePath,
          ...sourceFlags,
          '-overwrite',
          '-nlt',
          'PROMOTE_TO_MULTI',
          '-gt',
          '500000',
          '--config',
          'OAPIF_PAGE_SIZE',
          '5000',
          '--config',
          'GDAL_CACHEMAX',
          '2048',
        ].filter(Boolean);

        try {
          await runOgr(downloadArgs, `${item.id}-download`, lmEnv, OGR_DOWNLOAD_TIMEOUT_MS);
          const stat = fs.statSync(effectiveTargetPath);
          const mb = (stat.size / 1024 / 1024).toFixed(1);
          console.log(
            `   - Download complete for ${item.id}: ${effectiveTargetPath} (${mb} MB, ${formatElapsed(itemStart)})`,
          );
          sourcePath = effectiveTargetPath;
          sourceFlags.length = 0;
          return;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const canRetry = attempt < OGR_REMOTE_RETRY_ATTEMPTS && isTransientRemoteOgrError(message);
          if (!canRetry) {
            throw error;
          }

          const backoffMs = attempt * 5000;
          console.warn(
            `   ⚠️  Remote fetch failed for ${item.id} (attempt ${attempt}/${OGR_REMOTE_RETRY_ATTEMPTS}): ${message.split('\n')[0]}`,
          );
          console.warn(`   - Retrying ${item.id} download in ${Math.round(backoffMs / 1000)}s...`);
          await sleep(backoffMs);
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    const shouldUseDownloadedFile =
      isRemoteSourcePath &&
      bestLocalDownloadedPath !== null &&
      !FORCE_REDOWNLOAD &&
      (FROM_DOWNLOADED || DOWNLOAD_FIRST || LOCAL_ONLY);

    if (shouldUseDownloadedFile) {
      console.log(`   - Using downloaded GPKG already on disk: ${bestLocalDownloadedPath}`);
      sourcePath = bestLocalDownloadedPath;
      sourceFlags.length = 0;
      usedExistingDownloadedFile = true;
    } else if (LOCAL_ONLY && isRemoteSourcePath) {
      console.warn(`   ⚠️  Skipped ${item.id}: no usable local GPKG found (${localDownloadPath})`);
      skippedLocalOnlyIds.push(String(item.id));
      return;
    } else if ((DOWNLOAD_FIRST || FROM_DOWNLOADED) && isRemoteSourcePath) {
      await downloadToLocal();
    }

    const isFileBased = !sourcePath.startsWith('OAPIF:') && !sourcePath.startsWith('WFS:');
    const pgArgs = [
      '-f',
      'PostgreSQL',
      pgConn,
      sourcePath,
      ...sourceFlags,
      '-nln',
      item.table,
      '-overwrite',
      '-gt',
      isFileBased ? '500000' : '65536',
      '-nlt',
      'PROMOTE_TO_MULTI',
      '-lco',
      'GEOMETRY_NAME=geom',
      '-lco',
      'SPATIAL_INDEX=NONE',
      '-lco',
      'UNLOGGED=YES',
      '--config',
      'PG_USE_COPY',
      'YES',
      '--config',
      'GDAL_CACHEMAX',
      '2048',
      '-t_srs',
      TARGET_SRS,
      ...(isFileBased ? [] : ['--config', 'OAPIF_PAGE_SIZE', '5000']),
    ].filter(Boolean);

    if (sourcePath.endsWith('.shp')) {
      pgArgs.push('-lco', 'ENCODING=UTF-8', '--config', 'SHAPE_ENCODING', 'LATIN1');
    }

    console.log(`   - Streaming into PostgreSQL for ${item.id} (UNLOGGED, COPY mode)...`);
    try {
      await runOgr(pgArgs, item.id, isFileBased ? undefined : lmEnv);
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      const canRetryTransientRemoteStream = !isFileBased && isTransientRemoteOgrError(message);

      if (canRetryTransientRemoteStream) {
        console.warn(`   ⚠️  Transient remote error for ${item.id}. Retrying stream once...`);
        await sleep(3000);
        try {
          await runOgr(pgArgs, `${item.id}-stream-retry`, isFileBased ? undefined : lmEnv);
          message = '';
        } catch (retryError) {
          message = retryError instanceof Error ? retryError.message : String(retryError);
        }
      }

      if (message === '') {
        // Stream retry succeeded.
      } else {
        const canRetryCorruptLocal =
          usedExistingDownloadedFile &&
          'url' in item &&
          sourcePath === localDownloadPath &&
          isRecoverableLocalGpkgError(message);

        if (!canRetryCorruptLocal || LOCAL_ONLY) {
          throw new Error(message);
        }

        console.warn(
          `   ⚠️  Local downloaded GPKG for ${item.id} appears broken. Redownloading and retrying once...`,
        );
        let retryDownloadPath = localDownloadPath;
        if (fs.existsSync(localDownloadPath)) {
          try {
            const quarantinedPath = `${localDownloadPath}.bad-${Date.now()}`;
            fs.renameSync(localDownloadPath, quarantinedPath);
            markDownloadedFileQuarantined(localDownloadPath, `renamed-to=${path.basename(quarantinedPath)}`);
          } catch {
            markDownloadedFileQuarantined(localDownloadPath, 'rename-failed-or-locked');
            retryDownloadPath = path.join(DOWNLOAD_DIR, `${item.id}-retry-${Date.now()}.gpkg`);
          }
        }

        if ('url' in item && item.url) {
          const sourceType = 'type' in item && item.type === 'WFS' ? 'WFS' : 'OAPIF';
          sourcePath = `${sourceType}:${item.url}`;
        }
        sourceFlags.length = 0;
        if ('featureType' in item && item.featureType) {
          sourceFlags.push(String(item.featureType));
        }
        await downloadToLocal(retryDownloadPath);

        const retryArgs = [
          '-f',
          'PostgreSQL',
          pgConn,
          sourcePath,
          ...sourceFlags,
          '-nln',
          item.table,
          '-overwrite',
          '-gt',
          '500000',
          '-nlt',
          'PROMOTE_TO_MULTI',
          '-lco',
          'GEOMETRY_NAME=geom',
          '-lco',
          'SPATIAL_INDEX=NONE',
          '-lco',
          'UNLOGGED=YES',
          '--config',
          'PG_USE_COPY',
          'YES',
          '--config',
          'GDAL_CACHEMAX',
          '2048',
          '-t_srs',
          TARGET_SRS,
        ];

        if (sourcePath.endsWith('.shp')) {
          retryArgs.push('-lco', 'ENCODING=UTF-8', '--config', 'SHAPE_ENCODING', 'LATIN1');
        }

        await runOgr(retryArgs, `${item.id}-retry`, lmEnv);
      }
    }

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

  const importPromises = activeCollections.map((item) =>
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
  const successCount = activeCollections.length - failedCount - skippedLocalOnlyIds.length;

  // Build spatial indexes on all successfully imported tables at the end,
  // with high maintenance_work_mem already set for the session.
  if (successCount > 0) {
    console.log(`\n🔧 Building spatial indexes (parallel, maintenance_work_mem=4GB)...`);
    const idxStart = Date.now();
    const skippedSet = new Set(skippedLocalOnlyIds);
    const successfulTables = activeCollections
      .filter((item, i) => results[i].status === 'fulfilled' && !skippedSet.has(String(item.id)))
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
  console.log(`   Collections: ${activeCollections.length}`);
  console.log(`   Disabled:    ${disabledCollections.length}`);
  console.log(`   Successful:  ${successCount}`);
  if (skippedLocalOnlyIds.length > 0) {
    console.log(`   Skipped:     ${skippedLocalOnlyIds.length}`);
    console.log(`   Skipped IDs: ${skippedLocalOnlyIds.join(', ')}`);
  }
  console.log(`   Failed:      ${failedCount}`);
  if (failedCount > 0) {
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? activeCollections[i].id : null))
      .filter(Boolean);
    console.log(`   Failed IDs:  ${failed.join(', ')}`);
  }

  await prisma.$disconnect();
  if (failedCount > 0) {
    process.exit(1);
  }
}

runImport();
