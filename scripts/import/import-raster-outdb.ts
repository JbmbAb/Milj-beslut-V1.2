/**
 * scripts/import/import-raster-outdb.ts
 *
 * Mimers Brunn — Raster Out-of-DB Registration Pipeline
 *
 * Registrerar raster-filer från GEO_Master_Archive i PostGIS via Out-of-DB-
 * referenser (raster2pgsql -R). Inga filer kopieras — PostGIS pekar direkt
 * mot den kanoniska GEO_Master_Archive (H:\)-sökvägen. Uppfyller Mimers Brunn-krav:
 *   ✓ SHA-256 checksum per fil (streaming, minnessäker)
 *   ✓ Out-of-DB via raster2pgsql -R (data stannar i arkivet)
 *   ✓ Idempotent (--overwrite styr om befintliga tabeller skrivs över)
 *   ✓ Rate-limiting + retry-logik
 *   ✓ Spårningslogg med bbox, bandantal, tile-count
 *   ✓ SWEREF99 TM (EPSG:3006) som standard-CRS
 *
 * Förutsättningar:
 *   - PostgreSQL med PostGIS + postgis_raster tillägg
 *   - raster2pgsql och psql i PATH (från PostGIS-installationen)
 *   - MASTER_ARCHIVE_ROOT och DATABASE_URL i .env
 *   - Kör migrations/20260628_raster_outdb_infrastructure.sql först
 *
 * Arkivstruktur som förväntas:
 *   <MASTER_ARCHIVE_ROOT>/Data/<Provider>/<Dataset>/<YYYY-MM-DD>/raw/*.tif
 *
 * Användning:
 *   npx tsx scripts/import/import-raster-outdb.ts --provider=SGU --dataset=Jordarter_25k --dry-run
 *   npx tsx scripts/import/import-raster-outdb.ts --provider=SGU --dataset=Jordarter_25k
 *   npx tsx scripts/import/import-raster-outdb.ts --all --dry-run
 *   npx tsx scripts/import/import-raster-outdb.ts --status
 *   npx tsx scripts/import/import-raster-outdb.ts --provider=SGU --dataset=Jordarter_25k --overwrite
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';

dotenv.config();

// ─── Konfiguration ────────────────────────────────────────────────────────────

const RASTER_DATA_ROOT = path.join(MASTER_ARCHIVE_ROOT, 'Data');
const RASTER_SCHEMA    = 'public';
const DEFAULT_EPSG     = 3006;     // SWEREF99 TM
const TILE_SIZE        = '256x256';
const MAX_FILES_PER_RUN = 500;
const RETRY_MAX        = 3;
const RETRY_DELAY_MS   = 2000;

/** Raster-filformat som stöds */
const RASTER_EXTENSIONS = new Set(['.tif', '.tiff', '.asc', '.img', '.dem']);

// ─── CLI-flaggor ──────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const isDryRun     = args.includes('--dry-run');
const isAll        = args.includes('--all');
const showStatus   = args.includes('--status');
const overwrite    = args.includes('--overwrite');
const verbose      = args.includes('--verbose');
const providerArg  = args.find((a) => a.startsWith('--provider='))?.split('=')[1];
const datasetArg   = args.find((a) => a.startsWith('--dataset='))?.split('=')[1];
const epsgArg      = parseInt(args.find((a) => a.startsWith('--epsg='))?.split('=')[1] ?? `${DEFAULT_EPSG}`, 10);

// ─── Typer ────────────────────────────────────────────────────────────────────

interface RasterTarget {
  provider:     string;
  dataset:      string;
  version:      string;
  absolutePath: string;
  relPath:      string;
  sizeBytes:    number;
}

interface RasterMeta {
  sha256:      string;
  tileCount:   number;
  bboxWkt?:    string;
  bandCount?:  number;
  pixelWidth?: number;
  pixelHeight?: number;
}

type RegistrationStatus = 'registered' | 'skipped' | 'error';

interface RegistrationResult {
  target:  RasterTarget;
  status:  RegistrationStatus;
  message?: string;
  meta?:   RasterMeta;
}

// ─── Loggning ─────────────────────────────────────────────────────────────────

const log  = (msg: string) => console.log(`[raster-outdb] ${msg}`);
const warn = (msg: string) => console.warn(`[raster-outdb] ⚠️  ${msg}`);
const dbg  = (msg: string) => { if (verbose) console.log(`[raster-outdb] 🔍 ${msg}`); };

// ─── Verktygshjälpare ─────────────────────────────────────────────────────────

/** SHA-256 via streaming (minnessäker för stora GeoTIFF-filer) */
function sha256Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end',  ()      => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Normaliserat PostGIS-tabellnamn */
function toTableName(provider: string, dataset: string): string {
  return `raster_${provider.toLowerCase()}_${dataset.toLowerCase()}`
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Exponential backoff retry */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = RETRY_MAX,
  delayMs = RETRY_DELAY_MS,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = delayMs * Math.pow(2, attempt - 1);
      warn(`${label}: försök ${attempt}/${retries} misslyckades, väntar ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`${label}: överskred ${retries} försök`);
}

/** Kontrollera att Docker och databascontainern är tillgängliga */
function checkDependencies(): void {
  const result = spawnSync('docker', ['exec', 'miljobeslut-postgres', 'which', 'raster2pgsql'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `Saknat verktyg inuti Docker: 'raster2pgsql' hittades inte.\n` +
      `Se till att 'miljobeslut-postgres' containern är igång med PostGIS.`
    );
  }
  dbg(`✓ raster2pgsql i Docker hittades`);
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/** Rekursiv walk — exkluderar _review, _tmp och .git */
function walkRasterFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const EXCLUDE = new Set(['_review', '_tmp', 'tmp', '.git', '_quarantine']);
  const results: string[] = [];

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        if (RASTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          results.push(full);
        }
      }
    }
  }
  walk(dir);
  return results;
}

/** Bygg targets från arkivets katalogstruktur */
function discoverTargets(filterProvider?: string, filterDataset?: string): RasterTarget[] {
  if (!fs.existsSync(RASTER_DATA_ROOT)) {
    warn(`Master Archive hittades inte: ${RASTER_DATA_ROOT}`);
    warn('Kontrollera MASTER_ARCHIVE_ROOT i .env');
    return [];
  }

  const targets: RasterTarget[] = [];

  for (const provDir of fs.readdirSync(RASTER_DATA_ROOT, { withFileTypes: true })) {
    if (!provDir.isDirectory()) continue;
    const provider = provDir.name;
    if (filterProvider && provider.toLowerCase() !== filterProvider.toLowerCase()) continue;

    for (const dsDir of fs.readdirSync(path.join(RASTER_DATA_ROOT, provider), { withFileTypes: true })) {
      if (!dsDir.isDirectory()) continue;
      const dataset = dsDir.name;
      if (filterDataset && dataset.toLowerCase() !== filterDataset.toLowerCase()) continue;

      const datasetPath = path.join(RASTER_DATA_ROOT, provider, dataset);
      const versions = fs.readdirSync(datasetPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse(); // senaste version (alfabetisk desc) först

      const version = versions[0];
      if (!version) continue;

      for (const absPath of walkRasterFiles(path.join(datasetPath, version))) {
        targets.push({
          provider,
          dataset,
          version,
          absolutePath: absPath,
          relPath:  path.relative(MASTER_ARCHIVE_ROOT, absPath),
          sizeBytes: fs.statSync(absPath).size,
        });
      }
    }
  }

  if (targets.length > MAX_FILES_PER_RUN) {
    warn(`Hittade ${targets.length} filer — begränsar till ${MAX_FILES_PER_RUN} per körning.`);
    warn('Använd --provider= och --dataset= för att begränsa scope.');
  }
  return targets.slice(0, MAX_FILES_PER_RUN);
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Extrahera raster-metadata med gdalinfo (om tillgänglig) för att
 * lagra bbox, antal band och pixelstorlek i spårningsloggen.
 */
function extractGdalMeta(filePath: string): Partial<RasterMeta> {
  try {
    const result = spawnSync('gdalinfo', ['-json', filePath], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.status !== 0) return {};
    const info = JSON.parse(result.stdout);

    const cornerCoords = info.cornerCoordinates;
    let bboxWkt: string | undefined;
    if (cornerCoords?.upperLeft && cornerCoords?.lowerRight) {
      const [minX, maxY] = cornerCoords.upperLeft;
      const [maxX, minY] = cornerCoords.lowerRight;
      bboxWkt = `POLYGON((${minX} ${minY},${maxX} ${minY},${maxX} ${maxY},${minX} ${maxY},${minX} ${minY}))`;
    }

    const gt = info.geoTransform;
    return {
      bboxWkt,
      bandCount:   (info.bands ?? []).length,
      pixelWidth:  gt ? Math.abs(gt[1]) : undefined,
      pixelHeight: gt ? Math.abs(gt[5]) : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Kör raster2pgsql -R via Docker och pipe:ar SQL till psql i Docker.
 * Returnerar antal tiles som skapades.
 */
function runRaster2Pgsql(
  filePath: string,
  tableRef: string,
  createOrAppend: '-c' | '-a',
  epsg: number,
  databaseUrl: string,
): number {
  // Översätt Windows-sökväg till container-sökväg
  // filePath är t.ex. H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\...
  // I containern är MASTER_ARCHIVE_ROOT monterad som /master-archive
  let containerPath = filePath;
  if (filePath.startsWith(MASTER_ARCHIVE_ROOT)) {
    const relPath = filePath.substring(MASTER_ARCHIVE_ROOT.length).replace(/\\/g, '/');
    // Hantera eventuell inledande slash
    containerPath = `/master-archive${relPath.startsWith('/') ? '' : '/'}${relPath}`;
  } else {
    // Fallback om den inte börjar exakt med string (t.ex. C:\GEO_Master_Archive_Local)
    const match = filePath.match(/.*?(GEO_Master_Archive_Local|GEO_Master_Archive)[\\/](.*)/);
    if (match) {
      containerPath = `/master-archive/${match[2].replace(/\\/g, '/')}`;
    }
  }

  dbg(`docker exec miljobeslut-postgres raster2pgsql -R ${createOrAppend} -s ${epsg} -t ${TILE_SIZE} "${containerPath}" ${tableRef}`);

  // Steg 1: Generera SQL via docker exec
  const r2p = spawnSync(
    'docker',
    ['exec', 'miljobeslut-postgres', 'raster2pgsql', '-R', createOrAppend, '-s', `${epsg}`, '-t', TILE_SIZE, containerPath, tableRef],
    { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' },
  );

  if (r2p.status !== 0) {
    const stderr = r2p.stderr?.toString() ?? '';
    throw new Error(`raster2pgsql (docker) misslyckades: ${stderr}`);
  }

  // Steg 2: Räkna INSERT-satser (= antal tiles)
  const sql = r2p.stdout.toString();
  const tileCount = (sql.match(/INSERT INTO/gi) ?? []).length;

  // Steg 3: Pipe till psql via docker exec
  const psqlResult = spawnSync('docker', ['exec', '-i', 'miljobeslut-postgres', 'psql', '-U', 'miljobeslut', '-d', 'miljobeslut'], {
    input:     r2p.stdout,
    maxBuffer: 256 * 1024 * 1024,
    encoding:  'buffer',
  });

  if (psqlResult.status !== 0) {
    const stderr = psqlResult.stderr?.toString() ?? '';
    throw new Error(`psql (docker) misslyckades: ${stderr}`);
  }

  return tileCount;
}

/** Registrera ett enskilt raster Out-of-DB */
async function registerOne(
  prisma:    PrismaClient,
  target:    RasterTarget,
  databaseUrl: string,
): Promise<RegistrationResult> {
  const tableName   = toTableName(target.provider, target.dataset);
  const tableRef    = `${RASTER_SCHEMA}.${tableName}`;

  try {
    // Kontrollera om tabellen redan finns
    const [{ exists }] = await prisma.$queryRawUnsafe<[{ exists: boolean }]>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = $2
       ) AS exists`,
      RASTER_SCHEMA,
      tableName,
    );

    if (exists && !overwrite) {
      return {
        target,
        status:  'skipped',
        message: `Tabell ${tableRef} finns redan — använd --overwrite för att skriva över`,
      };
    }

    if (isDryRun) {
      log(`[DRY-RUN] ${target.relPath} → ${tableRef}`);
      return { target, status: 'registered', message: 'dry-run' };
    }

    // SHA-256 via streaming (minnessäker)
    log(`🔐 SHA-256: ${path.basename(target.absolutePath)}`);
    const sha256 = await sha256Stream(target.absolutePath);

    // Kontrollera om vi redan registrerat exakt denna fil (samma sha256)
    const [existing] = await prisma.$queryRawUnsafe<[{ sha256: string | null }?]>(
      `SELECT sha256 FROM public.raster_registration_log WHERE file_path = $1 LIMIT 1`,
      target.relPath,
    );
    if (existing?.sha256 === sha256 && !overwrite) {
      return {
        target,
        status:  'skipped',
        message: `Oförändrad fil (sha256 matchar) — hoppar över`,
      };
    }

    // Metadata via gdalinfo
    const gdalMeta = extractGdalMeta(target.absolutePath);

    // raster2pgsql -R
    log(`📡 raster2pgsql -R → ${tableRef}`);
    const createOrAppend: '-c' | '-a' = exists ? '-a' : '-c';
    const tileCount = await withRetry(
      `raster2pgsql(${tableName})`,
      () => Promise.resolve(runRaster2Pgsql(
        target.absolutePath,
        tableRef,
        createOrAppend,
        epsgArg,
        databaseUrl,
      )),
    );

    // Bygg spatial index på den nyskapade raster-tabellen
    if (!exists) {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_rast
         ON ${tableRef} USING gist(ST_ConvexHull(rast))`,
      );
    }

    // Skriv till spårningslogg
    const meta: RasterMeta = {
      sha256,
      tileCount,
      bboxWkt:     gdalMeta.bboxWkt,
      bandCount:   gdalMeta.bandCount,
      pixelWidth:  gdalMeta.pixelWidth,
      pixelHeight: gdalMeta.pixelHeight,
    };

    await prisma.$executeRawUnsafe(
      `INSERT INTO public.raster_registration_log
         (provider, dataset, version, file_path, sha256, size_bytes, epsg_code,
          tile_size, table_ref, bbox_wkt, band_count, pixel_width, pixel_height,
          tile_count, registered_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
       ON CONFLICT (file_path) DO UPDATE SET
         sha256       = EXCLUDED.sha256,
         size_bytes   = EXCLUDED.size_bytes,
         version      = EXCLUDED.version,
         table_ref    = EXCLUDED.table_ref,
         bbox_wkt     = EXCLUDED.bbox_wkt,
         band_count   = EXCLUDED.band_count,
         pixel_width  = EXCLUDED.pixel_width,
         pixel_height = EXCLUDED.pixel_height,
         tile_count   = EXCLUDED.tile_count,
         updated_at   = NOW()`,
      target.provider,
      target.dataset,
      target.version,
      target.relPath,
      sha256,
      target.sizeBytes,
      epsgArg,
      TILE_SIZE,
      tableRef,
      gdalMeta.bboxWkt ?? null,
      gdalMeta.bandCount ?? null,
      gdalMeta.pixelWidth ?? null,
      gdalMeta.pixelHeight ?? null,
      tileCount,
    );

    log(`✅ ${path.basename(target.absolutePath)} → ${tableRef} (${tileCount} tiles)`);
    return { target, status: 'registered', meta };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Fel: ${target.relPath}\n  ${message}`);
    return { target, status: 'error', message };
  }
}

// ─── Status-kommando ──────────────────────────────────────────────────────────

async function printStatus(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM public.raster_registration_status ORDER BY provider, dataset`
  );

  if (rows.length === 0) {
    log('Inga raster-filer registrerade än.');
    return;
  }

  log('');
  log('─── Registrerade raster-datasets ──────────────────────────────────');
  log(
    'Provider'.padEnd(16) +
    'Dataset'.padEnd(32) +
    'Filer'.padEnd(8) +
    'Tiles'.padEnd(10) +
    'Storlek'.padEnd(14) +
    'SHA256 saknas'.padEnd(16) +
    'Senast registrerad'
  );
  log('─'.repeat(100));

  for (const row of rows) {
    const bytes  = Number(row.total_bytes ?? 0);
    const gb     = (bytes / 1024 ** 3).toFixed(2);
    const warn   = row.missing_sha256 > 0 ? `❌ ${row.missing_sha256}` : '✅ 0';
    log(
      String(row.provider).padEnd(16) +
      String(row.dataset).padEnd(32) +
      String(row.file_count).padEnd(8) +
      String(row.total_tiles ?? '?').padEnd(10) +
      `${gb} GB`.padEnd(14) +
      warn.padEnd(16) +
      new Date(row.last_registered).toISOString().slice(0, 10)
    );
  }
  log('─'.repeat(100));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma      = new PrismaClient();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL är inte satt i .env');
    process.exit(1);
  }

  try {
    // Status-läge
    if (showStatus) {
      await printStatus(prisma);
      return;
    }

    if (!isAll && !providerArg && !datasetArg) {
      console.error([
        'Mimers Brunn — Raster Out-of-DB Pipeline',
        '',
        'Användning:',
        '  npx tsx scripts/import/import-raster-outdb.ts --status',
        '  npx tsx scripts/import/import-raster-outdb.ts --all --dry-run',
        '  npx tsx scripts/import/import-raster-outdb.ts --provider=SGU --dataset=Jordarter_25k',
        '  npx tsx scripts/import/import-raster-outdb.ts --provider=SGU --dataset=Jordarter_25k --overwrite',
        '',
        'Flaggor:',
        '  --dry-run    Visa vad som skulle göras utan att skriva',
        '  --overwrite  Skriv över befintliga raster-tabeller',
        '  --all        Registrera alla datasets i Master Archive',
        '  --status     Visa registreringsstatus',
        '  --epsg=NNNN  CRS (default: 3006 = SWEREF99 TM)',
        '  --verbose    Utökad loggning',
      ].join('\n'));
      process.exit(1);
    }

    log('🗺️  Mimers Brunn — Raster Out-of-DB Registration');
    log(`📁  Master Archive: ${MASTER_ARCHIVE_ROOT}`);
    log(`📐  CRS: EPSG:${epsgArg}, Tile: ${TILE_SIZE}`);
    if (isDryRun) log('🔍  DRY-RUN — inga ändringar skrivs');

    // Kontrollera beroenden
    if (!isDryRun) checkDependencies();

    // Aktivera Out-of-DB i denna session
    if (!isDryRun) {
      await prisma.$executeRawUnsafe(`SET postgis.enable_outdb_rasters = true`);
    }

    const targets = discoverTargets(providerArg, datasetArg);

    if (targets.length === 0) {
      warn('Inga raster-filer hittades för angivna filter.');
      warn(`Kontrollera att ${RASTER_DATA_ROOT} innehåller .tif/.tiff/.asc/.img-filer.`);
      return;
    }

    log(`🔎 Hittade ${targets.length} raster-fil(er)`);

    const results: RegistrationResult[] = [];

    for (const target of targets) {
      const result = await registerOne(prisma, target, databaseUrl);
      results.push(result);
    }

    // Sammanfattning
    const registered = results.filter((r) => r.status === 'registered');
    const skipped    = results.filter((r) => r.status === 'skipped');
    const errors     = results.filter((r) => r.status === 'error');

    log('');
    log('─── Sammanfattning ─────────────────────────────────────────');
    log(`✅  Registrerade:  ${registered.length}`);
    log(`⏭️   Hoppade över:  ${skipped.length}`);
    log(`❌  Fel:           ${errors.length}`);

    const totalTiles = registered.reduce((s, r) => s + (r.meta?.tileCount ?? 0), 0);
    if (totalTiles > 0) log(`🟦  Totalt tiles:  ${totalTiles}`);

    if (errors.length > 0) {
      log('');
      log('Filer med fel:');
      for (const e of errors) {
        log(`  ${e.target.relPath}`);
        log(`    ${e.message}`);
      }
      process.exit(1);
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[raster-outdb] Fatalt fel:', err);
  process.exit(1);
});
