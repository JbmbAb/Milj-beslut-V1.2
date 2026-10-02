import * as fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { prisma } from '../../server/db/prisma';
import { getRegistryEntry } from './config/importRegistry';
import {
  assertExpectedColumnsPresent,
  assertStagingQaPasses,
  repairInvalidGeometries,
  applyPostImportIndexing,
  buildPromoteInsertSql,
  countTableRows,
  ensureGiSTIndex,
  formatPromoteAuditSummary,
  formatStagingQaSummary,
  OGR2OGR_PGOPTIONS,
  parseOgrinfoFieldNames,
  resetBulkImportSession,
  runStagingVectorQa,
  setBulkImportSession,
  smokeMapLayerForTable,
  tableExists,
  vacuumAnalyzeTable,
} from './importLibrarianQa';
import {
  type ArchiveManifestV2,
  ensureArchiveManifestV2,
  isImportEligible,
  readQaStatus,
  validateArchiveManifestStructure,
} from './types/manifestSchema';
import {
  flushManifestWriteBackQueue,
  formatQaError,
  scheduleManifestWriteBack,
  updateManifestStateLocal,
  type ManifestQAUpdate,
} from './utils/manifestWriteBack';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { syncPropertyUnitFromEnv } from '../db/sync-property-unit-from-env';
import type { ArtifactRepositoryPort } from '../../packages/mps-runtime/src/kernel/ExecutionKernel';
import {
  SpatialDatasetRetentionError,
  type SqlPort,
  type TransactionalSqlPort,
} from '../../packages/spatial-provider-postgis/src/SpatialDatasetRetention';
import {
  retentionTransactionTimeoutMs,
  committedRetentionDigestPrecondition,
} from '../../packages/spatial-provider-postgis/src/RetentionDigestPrecondition';
// U30F F1: every destructive step of this script (promote TRUNCATE, import-staging overwrite,
// cleanup-staging DROP) goes through the one protected relation gate.
import {
  CLEANUP_SKIPPED_RETAINED_RELATION,
  REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED,
  assertStagingImportOverwriteAllowed,
  dropStagingRelationGoverned,
  planStagingCleanup,
  quoteStagingRelation,
  recordRetentionAtPromote,
  retainOutgoingThenReplace,
} from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';

dotenv.config();

type PrismaSqlClient = Pick<typeof prisma, '$queryRawUnsafe' | '$executeRawUnsafe'>;

/** SPATIAL-DATASET-RETENTION-V1 SQL port over the Prisma client (or an interactive transaction client). */
function prismaSqlPort(client: PrismaSqlClient): SqlPort {
  return {
    query: async <T,>(sql: string, params: readonly unknown[] = []) => ({
      rows: (await client.$queryRawUnsafe<T[]>(sql, ...params)) as T[],
    }),
    execute: async (sql: string, params: readonly unknown[] = []) => {
      await client.$executeRawUnsafe(sql, ...params);
    },
  };
}

function prismaTransactionalSqlPort(): TransactionalSqlPort {
  return {
    ...prismaSqlPort(prisma),
    // Same transaction timeout as the TRUNCATE + INSERT promote always had (600 s, unchanged); read from
    // retention-digest-preconditions.v1.json so the F4 lock-budget check and the real timeout cannot drift.
    transaction: (work) => prisma.$transaction((tx) => work(prismaSqlPort(tx)), { timeout: retentionTransactionTimeoutMs() }),
  };
}

/**
 * PRES-05: the retention record goes to the ONE durable Mimers CAS (PRES-19), fail-closed: without
 * it a `replace` promote is refused before anything is written.
 */
async function openRetentionCas(): Promise<ArtifactRepositoryPort> {
  try {
    const { MimersIntegration } = await import('../../packages/mps-runtime/src/mimers/MimersIntegration');
    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    return mimers.artifactRepository;
  } catch (error) {
    throw new SpatialDatasetRetentionError(
      REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED,
      'CAS_UNAVAILABLE',
      `the durable Mimers CAS could not be opened for the retention record: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}



const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const OGRINFO_PATH = process.env.OGRINFO_PATH || 'C:\\Program Files\\GDAL\\ogrinfo.exe';
const POSTGIS_CONTAINER = process.env.POSTGIS_CONTAINER || 'miljobeslut-postgres';
const POSTGIS_MOUNT_ROOT = process.env.POSTGIS_MOUNT_ROOT || '/mnt/drive'; // Path inside Docker container where H: is mounted
const QA_LOG_DIR = path.join(process.cwd(), 'storage', 'manifests', 'import-qa');

type Manifest = ArchiveManifestV2;

// Arguments
const args = process.argv.slice(2);
let manifestDir = '';
let dataDir = '';
let onlyHash = '';
let execute = false;
let mode = 'plan'; // 'plan' | 'import-staging' | 'promote'
let writeBackManifest = false;
let retryFailed = false;

const writeBackQueue: Array<Promise<{ ok: boolean; remotePath: string; error?: string }>> = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest-dir') manifestDir = args[++i];
  if (args[i] === '--data-dir') dataDir = args[++i];
  if (args[i] === '--only') onlyHash = args[++i];
  if (args[i] === '--execute') execute = true;
  if (args[i] === '--mode') mode = args[++i];
  if (args[i] === '--write-back-manifest') writeBackManifest = true;
  if (args[i] === '--retry-failed') retryFailed = true;
}

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err || ''),
  dry: (msg: string) => console.log(`[DRY-RUN] ${msg}`),
};

if (!manifestDir) {
  logger.warn('No --manifest-dir provided. Assuming test mode or expecting fallback.');
}

async function findPrimaryFile(manifest: Manifest, fullDataPath: string): Promise<string> {
  const exts = ['.shp', '.gpkg', '.gdb', '.geojson', '.gml', '.fgb', '.tif', '.tiff', '.asc'];
  for (const ext of exts) {
    const primary = manifest.files.find((f) => f.toLowerCase().endsWith(ext));
    if (primary) {
      if (ext === '.shp') {
        const hasShx = manifest.files.find((f) => f.toLowerCase().endsWith('.shx'));
        const hasDbf = manifest.files.find((f) => f.toLowerCase().endsWith('.dbf'));
        if (!hasShx || !hasDbf) {
          throw new Error(`Shapefile bundle missing .shx or .dbf components!`);
        }
      }
      return path.join(fullDataPath, primary);
    }
  }
  throw new Error('No primary spatial file found in manifest.');
}

function writeQaLog(batchId: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(QA_LOG_DIR, { recursive: true });
  fs.writeFileSync(path.join(QA_LOG_DIR, `${batchId}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

function scheduleQaWriteBack(manifestPath: string, manifest: Manifest, update: ManifestQAUpdate): void {
  const updated = updateManifestStateLocal(manifestPath, manifest, update);
  logger.info(`   [Local] Manifest -> qa_status=${update.qa_status} (${manifestPath})`);

  if (!writeBackManifest) return;
  scheduleManifestWriteBack(
    writeBackQueue,
    manifest.provider,
    manifest.dataset,
    manifest.version,
    update,
    {
      baseManifest: updated,
      logger: {
        log: (msg: string) => logger.info(msg),
        warn: (msg: string) => logger.warn(msg),
        error: (msg: string, err?: unknown) => logger.error(msg, err),
      },
    },
  );
}

async function processManifest(manifestPath: string) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = validateArchiveManifestStructure(parsed);
    if (!validated.ok) {
      throw new Error(`Invalid manifest schema at ${manifestPath}: ${(validated as { ok: false; errors: string[] }).errors.join('; ')}`);
    }
    const manifest: Manifest = validated.manifest;

    if (!retryFailed && !isImportEligible(manifest)) {
      throw new Error(
        `Manifest ${manifestPath} is not import-eligible (qa_status=${readQaStatus(manifest)})`,
      );
    }
    if (retryFailed && readQaStatus(manifest) === 'failed') {
      logger.warn(`   Retrying manifest with qa_status=failed (--retry-failed)`);
    }

    if (onlyHash && manifest.content_bundle_sha256 !== onlyHash) {
      return;
    }

    logger.info(`\n📦 Processing: ${manifest.provider} / ${manifest.dataset}`);

    // Import Registry lookup
    const registryEntry = getRegistryEntry(manifest.provider, manifest.dataset);
    const { target_schema, target_table } = registryEntry;
    const expectedColumns = [...registryEntry.expected_columns];
    logger.info(`   Registry Target: ${target_schema}.${target_table}`);
    if (expectedColumns.length > 0) {
      logger.info(`   Expected columns (${expectedColumns.length}): ${expectedColumns.slice(0, 6).join(', ')}${expectedColumns.length > 6 ? '…' : ''}`);
    }

    // Dedupe Check
    const existingSuccess = await prisma.postgisImportBatch.findFirst({
      where: {
        content_bundle_sha256: manifest.content_bundle_sha256,
        target_schema,
        target_table,
        status: 'SUCCESS',
      },
    });

    if (existingSuccess && !retryFailed) {
      logger.info(`   ⏭️ SKIPPED (Already imported successfully in batch ${existingSuccess.id})`);
      return;
    }
    if (existingSuccess && retryFailed) {
      logger.warn(`   Re-importing despite prior SUCCESS batch ${existingSuccess.id} (--retry-failed)`);
    }

    // Prepare variables
    const shortHash = manifest.content_bundle_sha256.substring(0, 8);
    const stagingSchema = 'lm_staging';
    const stagingTable = `${target_table}_${shortHash}`;
    const fullStagingTarget = `${stagingSchema}.${stagingTable}`;

    if (mode === 'plan') {
      logger.dry(`Would look for primary file in ${dataDir}`);
      logger.dry(`Would run ogr2ogr to staging table ${fullStagingTarget}`);
      logger.dry(`Would NOT touch ${target_schema}.${target_table}`);
      return;
    }

    // Locate Primary file
    // Data dir can be passed explicitly, otherwise assume it's next to the manifest
    const resolvedDataDir = dataDir || path.dirname(manifestPath);
    const primaryFilePath = await findPrimaryFile(manifest, resolvedDataDir);

    if (mode === 'import-staging') {
      if (!execute) {
        logger.dry(`[import-staging] Would run ogr2ogr from ${primaryFilePath} to ${fullStagingTarget}`);
        return;
      }

      // U30F F1 (PRES-05): ogr2ogr -overwrite replaces lm_staging.<table>_<hash8>, which may be the
      // retained relation of a bound version (same hash, --retry-failed, or an 8-hex collision).
      // Decided per relation BEFORE anything is written; a protected relation refuses the import.
      await assertStagingImportOverwriteAllowed({
        db: prismaSqlPort(prisma),
        relation: { schema: stagingSchema, table: stagingTable },
        openRepo: async () => {
          try {
            return await openRetentionCas();
          } catch {
            return null; // undecidable protection -> refused inside, never "unprotected"
          }
        },
      });

      logger.info(`   - Creating staging schema ${stagingSchema} if not exists...`);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema};`);

      const batch = await prisma.postgisImportBatch.create({
        data: {
          target_schema,
          target_table,
          status: 'STAGING_STARTED',
          manifest_path: manifestPath,
          content_bundle_sha256: manifest.content_bundle_sha256,
          import_mode: 'import-staging',
          source_runtime_path: primaryFilePath,
        },
      });

      try {
        const url = new URL(process.env.DATABASE_URL || '');
        const pgConn = `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;

        const isRaster = primaryFilePath.toLowerCase().match(/\.(tif|tiff|asc)$/);

        if (isRaster) {
          // RASTER FLOW (Out-of-DB via docker exec)
          logger.info(`   - Raster file detected. Using raster2pgsql inside Docker container '${POSTGIS_CONTAINER}'.`);

          // Guard: refuse to import from _review folders (Mimers Brunn policy)
          if (primaryFilePath.includes('_review')) {
            throw new Error(`Policy violation: File is inside a '_review' folder and has not been promoted to Master Archive. Move it to GEO_Master_Archive/Data/<Provider>/ first.`);
          }

          // Translate Windows path to Docker mount path
          // E.g. H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\x.tif -> /mnt/drive/Delade enheter/Miljöbeslut/GEO_Master_Archive/x.tif
          let containerPath = primaryFilePath;
          if (containerPath.match(/^[A-Za-z]:\\/)) {
            const pathWithoutDrive = containerPath.substring(3).replace(/\\/g, '/');
            containerPath = `${POSTGIS_MOUNT_ROOT}/${pathWithoutDrive}`;
          }

          logger.info(`   - Container path: ${containerPath}`);

          const rasterArgs = [
            'exec', POSTGIS_CONTAINER,
            'raster2pgsql',
            '-R', // Out-of-DB (register only, no pixel copy)
            '-I', // Create GiST index
            '-C', // Apply raster constraints
            '-F', // Add filename column
            '-s', '3006', // Force SRID SWEREF99TM
            containerPath,
            fullStagingTarget
          ];

          const result = spawnSync('docker', rasterArgs, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 50 });

          if (result.status !== 0) {
            throw new Error(`raster2pgsql (docker exec) failed with status ${result.status}: ${result.stderr}`);
          }

          const sql = result.stdout;
          if (!sql || sql.trim() === '') {
            throw new Error('raster2pgsql returned empty SQL. Check that the container path is accessible inside Docker.');
          }

          logger.info(`   - Executing raster registration SQL (${Math.round(sql.length / 1024)} KB)...`);
          await setBulkImportSession(prisma);
          try {
            const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(s => s.length > 0 && s !== 'BEGIN' && s !== 'COMMIT');
            for (const stmt of statements) {
              await prisma.$executeRawUnsafe(stmt + ';');
            }
          } finally {
            await resetBulkImportSession(prisma);
          }

          const rasterRows = await countTableRows(prisma, fullStagingTarget);
          if (rasterRows === 0) {
            throw new Error('Staging QA failed: zero raster rows registered');
          }
          logger.info(`   - Raster staging rows: ${rasterRows.toLocaleString()}`);

        } else {
          // VECTOR FLOW
          // Validation: Verify source CRS via ogrinfo
          logger.info(`   - Verifying source CRS using ogrinfo...`);
          const ogrinfoArgs = ['-so', primaryFilePath];
          if (registryEntry.ogr_layer) {
            ogrinfoArgs.push(registryEntry.ogr_layer);
          } else {
            ogrinfoArgs.push('-al');
          }
          const ogrinfoResult = spawnSync(OGRINFO_PATH, ogrinfoArgs, {
            encoding: 'utf-8',
            env: process.env,
          });
          
          if (ogrinfoResult.status !== 0) {
            throw new Error(
              `ogrinfo failed to read file. Status: ${ogrinfoResult.status}; cmd=${OGRINFO_PATH} ${ogrinfoArgs.map((a) => JSON.stringify(a)).join(' ')}; stderr=${(ogrinfoResult.stderr || '').slice(0, 800)}; stdout=${(ogrinfoResult.stdout || '').slice(0, 400)}`,
            );
          }

          const output = ogrinfoResult.stdout || '';
          // Look for typical CRS identifiers, e.g., "Coordinate System is:" or "PROJCRS"
          if (!output.includes('Coordinate System is:') && !output.includes('PROJCRS') && !output.includes('GEOGCRS')) {
            throw new Error(`Source file lacks a valid CRS. Cannot safely transform to EPSG:3006 without guessing.`);
          }

          if (expectedColumns.length > 0) {
            const sourceFields = parseOgrinfoFieldNames(output);
            assertExpectedColumnsPresent(sourceFields, expectedColumns);
            logger.info(`   - Source schema OK (${sourceFields.length} fields, expected ${expectedColumns.length})`);
          }

          const ogrLayer = registryEntry.ogr_layer;
          const isShapefile = primaryFilePath.toLowerCase().endsWith('.shp');
          const ogrArgs = [
            '-f', 'PostgreSQL',
            pgConn,
            primaryFilePath,
            ...(ogrLayer ? [ogrLayer] : []),
            '-nln', fullStagingTarget,
            '-overwrite',
            '-nlt', 'PROMOTE_TO_MULTI',
            '-skipfailures',
            '-lco', 'GEOMETRY_NAME=geom',
            '-lco', 'SPATIAL_INDEX=NONE', // Vi skapar GiST index manuellt efteråt
            ...(registryEntry.invert_axis_order
              ? ['-s_srs', 'EPSG:3006', '-t_srs', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs'] as const
              : ['-t_srs', 'EPSG:3006'] as const),
            '--config', 'PG_USE_COPY', 'YES',
            // NV/Swedish SHP attributes are typically CP1252 / Latin-1, not UTF-8
            // Prefer .cpg when present; ISO-8859-1 covers NV SPA/NR Swedish SHP
            ...(isShapefile ? ['--config', 'SHAPE_ENCODING', 'ISO-8859-1'] as const : []),
          ];

          logger.info(`   - Running ogr2ogr to ${fullStagingTarget}...`);
          const result = spawnSync(OGR2OGR_PATH, ogrArgs, {
            stdio: 'inherit',
            env: { ...process.env, PGOPTIONS: OGR2OGR_PGOPTIONS },
          });
          
          if (result.status !== 0) {
            throw new Error(`ogr2ogr failed with status ${result.status}`);
          }

          if (registryEntry.invert_axis_order) {
            logger.info(`   - Updating custom PROJ.4 SRID to EPSG:3006...`);
            await prisma.$executeRawUnsafe(
              `SELECT UpdateGeometrySRID('${stagingSchema}', '${stagingTable}', 'geom', 3006);`
            );
          }

          const repaired = await repairInvalidGeometries(prisma, fullStagingTarget);
          if (repaired > 0) {
            logger.info(`   - Repaired ${repaired} invalid geometries with ST_MakeValid`);
          }

          logger.info(`   - Running staging spatial QA...`);
          const stagingQa = await runStagingVectorQa(prisma, fullStagingTarget);
          logger.info(`   - ${formatStagingQaSummary(stagingQa)}`);
          assertStagingQaPasses(stagingQa);
          writeQaLog(batch.id, { manifestPath, stagingQa, qualifiedTable: fullStagingTarget });

          logger.info(`   - Creating GiST index on staging and running VACUUM ANALYZE...`);
          await setBulkImportSession(prisma);
          try {
            await ensureGiSTIndex(prisma, stagingSchema, stagingTable, `idx_${stagingTable}_geom`);
            try {
              await vacuumAnalyzeTable(prisma, fullStagingTarget);
            } catch (e) {
              logger.warn(`Could not run VACUUM ANALYZE on staging: ${(e as Error).message}`);
            }
          } finally {
            await resetBulkImportSession(prisma);
          }
        }

        await prisma.postgisImportBatch.update({
          where: { id: batch.id },
          data: {
            status: 'STAGING_IMPORTED',
            row_count: await countTableRows(prisma, fullStagingTarget),
            dataset_version: manifest.version,
          },
        });

        logger.info(`   ✅ Staging Import Successful.`);
        scheduleQaWriteBack(manifestPath, manifest, { qa_status: 'staging_ok' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.postgisImportBatch.update({
          where: { id: batch.id },
          data: { status: 'FAILED', error_message: message },
        });
        scheduleQaWriteBack(manifestPath, manifest, {
          qa_status: 'failed',
          qa_error: formatQaError(err),
        });
        logger.error(`   ❌ Failed: ${message}`);
        throw err instanceof Error ? err : new Error(message);
      }
    } else if (mode === 'promote') {
      // Find the STAGING_IMPORTED batch
      const stagedBatch = await prisma.postgisImportBatch.findFirst({
        where: {
          content_bundle_sha256: manifest.content_bundle_sha256,
          target_schema,
          target_table,
          status: 'STAGING_IMPORTED',
        },
        orderBy: { started_at: 'desc' }
      });

      if (!stagedBatch) {
        logger.warn(`   No STAGING_IMPORTED batch found for this bundle. Cannot promote.`);
        return;
      }

      if (!execute) {
        logger.dry(`[promote] Would run promote audit, then promote ${fullStagingTarget} -> ${target_schema}.${target_table}`);
        return;
      }

      const prodExists = await tableExists(prisma, target_schema, target_table);
      const stagingRows = await countTableRows(prisma, fullStagingTarget);
      const prodRowsBefore = prodExists ? await countTableRows(prisma, `${target_schema}.${target_table}`) : 0;

      if (stagingRows === 0) {
        logger.error(`   Promote audit failed: staging table ${fullStagingTarget} is empty`);
        return;
      }

      logger.info(
        `   - Promote audit: staging=${stagingRows.toLocaleString()}, prod_before=${prodRowsBefore.toLocaleString()}`,
      );

      const promoteStrategy = registryEntry.promote_strategy ?? 'replace';
      const retentionTarget = { schema: target_schema, table: target_table };
      // F4 (U30F): hard precondition for the listed large layers (the property layer), checked before
      // the ledger or the table is touched; retainOutgoingThenReplace checks it again. No override.
      if (promoteStrategy === 'replace') {
        const precondition = committedRetentionDigestPrecondition(retentionTarget);
        if (precondition.kind === 'UNMET') {
          throw new SpatialDatasetRetentionError(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED, 'DIGEST_TIME_PRECONDITION_UNMET', precondition.detail);
        }
      }
      // PRES-05 (U30-B): a `replace` promote needs the durable CAS for its retention records --
      // opened (fail-closed) before anything is written to the ledger or the table.
      const retentionRepo = promoteStrategy === 'replace' ? await openRetentionCas() : null;

      logger.info(`   - Promoting ${fullStagingTarget} -> ${target_schema}.${target_table}...`);
      await prisma.postgisImportBatch.update({
        where: { id: stagedBatch.id },
        data: { status: 'PROMOTE_STARTED' },
      });

      try {
        if (prodExists) {
          const insertSql = await buildPromoteInsertSql(
            prisma,
            target_schema,
            target_table,
            stagingSchema,
            stagingTable,
          );
          if (promoteStrategy === 'append') {
            logger.info(`   - Promote strategy: append (no TRUNCATE)`);
            await prisma.$executeRawUnsafe(insertSql);
          } else {
            // Retain the outgoing version (relation + digest + CAS record) BEFORE the TRUNCATE, in
            // the same ACCESS EXCLUSIVE transaction; any failure refuses the promote with
            // REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED and no TRUNCATE runs. No override.
            const retention = await retainOutgoingThenReplace({
              db: prismaTransactionalSqlPort(),
              repo: retentionRepo!,
              target: retentionTarget,
              insertSql,
            });
            if (retention.kind === 'RETAINED') {
              logger.info(
                `   - Outgoing version retained: ${retention.record.payload.retained_relation} ` +
                  `(batch ${retention.record.payload.import_batch_id}, rows=${retention.record.payload.row_count}, ` +
                  `record ${retention.record.artifact_id} ${retention.outcome}${retention.created_retained_relation ? ', relation created' : ''})`,
              );
            } else {
              // F5: only reachable for an EMPTY live table (checked under the exclusive lock). A live
              // table with rows but no SUCCESS batch is refused inside retainOutgoingThenReplace.
              logger.info(`   - First import: ${target_schema}.${target_table} was empty and has no SUCCESS batch; nothing to retain`);
            }
          }
        } else {
          logger.info(`   - Prod table missing — bootstrapping from staging...`);
          await prisma.$executeRawUnsafe(
            `CREATE TABLE ${target_schema}.${target_table} AS SELECT * FROM ${stagingSchema}.${stagingTable}`,
          );
        }

        const prodRowsAfter = await countTableRows(prisma, `${target_schema}.${target_table}`);
        const expectedProdRows =
          promoteStrategy === 'append' ? prodRowsBefore + stagingRows : stagingRows;
        if (prodRowsAfter !== expectedProdRows) {
          throw new Error(
            `Promote audit failed: staging=${stagingRows}, prod_before=${prodRowsBefore}, expected_after=${expectedProdRows}, prod_after=${prodRowsAfter}`,
          );
        }

        const promoteAudit = { stagingRows, prodRowsBefore, prodRowsAfter };
        logger.info(`   - ${formatPromoteAuditSummary(promoteAudit)}`);

        logger.info(`   - Post-promote: GiST + BRIN (if eligible) + VACUUM ANALYZE on ${target_schema}.${target_table}...`);
        let indexingResult: Awaited<ReturnType<typeof applyPostImportIndexing>> | undefined;
        try {
          indexingResult = await applyPostImportIndexing(prisma, target_schema, target_table);
          if (indexingResult.brinColumn) {
            logger.info(
              `   - BRIN index on ${indexingResult.brinColumn} (${indexingResult.rowCount.toLocaleString('sv-SE')} rows)`,
            );
          } else if (indexingResult.rowCount >= 100_000) {
            logger.warn(`   - No BRIN column (ogc_fid/fid/id) on ${target_schema}.${target_table}`);
          }
        } catch (e) {
          logger.warn(`Could not complete post-import indexing: ${(e as Error).message}`);
        }

        const smoke = await smokeMapLayerForTable(target_schema, target_table);
        if (smoke.skipped) {
          logger.warn(`   - Map-layer smoke skipped: ${smoke.detail}`);
        } else if (smoke.status === 'ok') {
          logger.info(`   - Map-layer smoke OK (${smoke.layerKey}): ${smoke.detail}`);
        } else {
          logger.warn(`   - Map-layer smoke ${smoke.status} (${smoke.layerKey}): ${smoke.detail}`);
        }

        writeQaLog(stagedBatch.id, {
          manifestPath,
          promoteAudit,
          indexing: indexingResult,
          smoke,
          promotedTo: `${target_schema}.${target_table}`,
        });

        // PRES-05 / PRES-06: --retry-failed no longer deletes earlier SUCCESS ledger rows for this
        // version. They are the history the retention records and the runtime binding rest on;
        // the latest SUCCESS row still wins (SpatialDatasetRuntimeBinding orders by completed_at).

        await prisma.postgisImportBatch.update({
          where: { id: stagedBatch.id },
          data: {
            status: 'SUCCESS',
            completed_at: new Date(),
            row_count: prodRowsAfter,
            dataset_version: manifest.version,
          },
        });

        logger.info(`   ✅ Promote Successful (Atomic, QA verified).`);

        if (retentionRepo) {
          // Retention of the incoming version from birth: its staging relation, verified equal to
          // live. The data is already promoted, so a failure here must not mark the batch FAILED;
          // it is reported loudly (exit code 1) and the next promote / the retention CLI records it.
          try {
            const recorded = await recordRetentionAtPromote({
              db: prismaSqlPort(prisma),
              repo: retentionRepo,
              target: retentionTarget,
              // F3: the ledger row count just written with SUCCESS is the basis's cross-check.
              incoming: { id: stagedBatch.id, content_bundle_sha256: manifest.content_bundle_sha256, dataset_version: manifest.version, row_count: prodRowsAfter },
            });
            logger.info(
              `   - Incoming version retention ${recorded.outcome}: ${recorded.record.payload.retained_relation} ` +
                `(record ${recorded.record.artifact_id})`,
            );
          } catch (retentionError: unknown) {
            const detail = retentionError instanceof Error ? retentionError.message : String(retentionError);
            logger.error(
              `   ❌ RETENTION_RECORD_AT_PROMOTE_FAILED for ${target_schema}.${target_table}@${manifest.content_bundle_sha256}: ${detail} ` +
                `(promote stands; record it with scripts/ops/retain-spatial-dataset-versions.ts --target ${target_schema}.${target_table} --execute)`,
            );
            process.exitCode = 1;
          }
        }

        if (target_table === 'registerenhetsomradesytor') {
          logger.info(`   - Syncing core.property_unit from env.registerenhetsomradesytor...`);
          try {
            const syncResult = await syncPropertyUnitFromEnv(prisma, { execute: true });
            logger.info(
              `   - core.property_unit sync OK: ${syncResult.coreRowsAfter.toLocaleString('sv-SE')} rows in ${(syncResult.durationMs / 1000).toFixed(1)}s`,
            );
            for (const check of syncResult.spotChecks) {
              logger.info(`     spot-check [${check.found ? 'OK' : 'MISS'}] ${check.designation}`);
            }
          } catch (syncErr: unknown) {
            const syncMessage = syncErr instanceof Error ? syncErr.message : String(syncErr);
            logger.error(`   ❌ core.property_unit sync failed: ${syncMessage}`);
            throw syncErr;
          }
        }

        scheduleQaWriteBack(manifestPath, manifest, { qa_status: 'passed' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.postgisImportBatch.update({
          where: { id: stagedBatch.id },
          data: { status: 'FAILED', error_message: `Promote failed: ${message}` },
        });
        scheduleQaWriteBack(manifestPath, manifest, {
          qa_status: 'failed',
          qa_error: formatQaError(err),
        });
        logger.error(`   ❌ Promote Failed: ${message}`);
        throw err instanceof Error ? err : new Error(message);
      }
    } else {
       logger.warn(`Unknown mode: ${mode}`);
    }

  } catch (err: any) {
    logger.error(`Failed to process manifest ${manifestPath}: ${err.message}`);
    throw err;
  }
}

async function cleanupStaging() {
  logger.info('\n🧹 Running Staging Garbage Collection...');
  
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const badBatches = await prisma.postgisImportBatch.findMany({
    where: {
      OR: [
        { status: 'FAILED' },
        { status: 'STAGING_STARTED', started_at: { lt: twentyFourHoursAgo } }
      ]
    }
  });

  if (badBatches.length === 0) {
    logger.info('   No failed or stalled staging tables found. Clean as a whistle!');
    return;
  }

  // PRES-05 (U30-B2 cleanup-staging): lm_staging.<table>_<hash8> of a FAILED batch is also the
  // retained relation of the SUCCESS version with the same hash. Every relation is checked BEFORE
  // any DROP: kept when a SUCCESS batch maps to it or a retention record exists for its version,
  // and kept (fail-closed) when that cannot be decided. A database error stops the whole cleanup.
  let retentionRepo: ArtifactRepositoryPort | null = null;
  try {
    retentionRepo = await openRetentionCas();
  } catch (casError: unknown) {
    logger.warn(
      `   ! Durable Mimers CAS unavailable (${casError instanceof Error ? casError.message : String(casError)}): ` +
        `retention records cannot be checked, so relations without a SUCCESS batch are kept`,
    );
  }
  const decisions = await planStagingCleanup({
    db: prismaSqlPort(prisma),
    repo: retentionRepo,
    candidates: badBatches.map((b) => ({
      id: b.id,
      status: b.status,
      target_schema: b.target_schema,
      target_table: b.target_table,
      content_bundle_sha256: b.content_bundle_sha256,
    })),
  });

  for (const decision of decisions) {
    const batches = decision.batch_ids.join(', ');
    if (decision.action === 'SKIP') {
      if (decision.code === CLEANUP_SKIPPED_RETAINED_RELATION) {
        logger.warn(
          `   - ${decision.code} [${decision.reason}]: keeping ${decision.relation_name} (batches ${batches})` +
            (decision.detail ? ` -- ${decision.detail}` : ''),
        );
      } else {
        logger.warn(`   - ${decision.code}: keeping ${decision.relation_name} (batches ${batches}): ${decision.detail}`);
        process.exitCode = 1;
      }
      continue;
    }

    const stagingTable = quoteStagingRelation(decision.relation);
    if (!execute) {
      logger.dry(`[cleanup-staging] Would run DROP TABLE ${stagingTable} after re-checking its protection under a lock (batches ${batches})`);
      continue;
    }
    // U30F F9: protection is decided again in the DROP's own transaction, under an ACCESS EXCLUSIVE
    // lock on the relation, immediately before the DROP; a change since the plan keeps the relation.
    logger.info(`   - Dropping ${stagingTable} (re-checked under lock)...`);
    try {
      const dropped = await dropStagingRelationGoverned({ db: prismaTransactionalSqlPort(), repo: retentionRepo, relation: decision.relation });
      if (dropped.outcome === 'DROPPED') logger.info(`   ✅ Dropped ${stagingTable}`);
      else if (dropped.outcome === 'ABSENT') logger.info(`   - ${stagingTable} no longer exists; nothing to drop`);
      else {
        const p = dropped.protection;
        logger.warn(`   - ${p.code} [${p.reason}]: keeping ${decision.relation_name} (batches ${batches}) -- changed since the plan: ${p.detail}`);
        if (p.code !== CLEANUP_SKIPPED_RETAINED_RELATION) process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`   ❌ Failed to drop ${stagingTable}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  if (mode === 'cleanup-staging') {
    await cleanupStaging();
  } else if (manifestDir) {
    if (!fs.existsSync(manifestDir)) {
      logger.error(`Manifest directory not found: ${manifestDir}`);
      process.exit(1);
    }
    const canonicalManifest = path.join(manifestDir, 'manifest.json');
    if (fs.existsSync(canonicalManifest)) {
      await processManifest(canonicalManifest);
    } else {
      const files = fs
        .readdirSync(manifestDir)
        .filter(
          (f) =>
            f.endsWith('.json') &&
            !f.startsWith('.') &&
            !f.includes('local_master_index') &&
            !f.startsWith('merge-') &&
            f !== 'checksums.txt',
        );
      if (files.length === 0) {
        logger.error(`No manifest.json in ${manifestDir}`);
        process.exit(1);
      }
      for (const file of files) {
        await processManifest(path.join(manifestDir, file));
      }
    }
  } else {
    // If running as a test/imported module, do nothing.
    logger.info('Unified Ingester initialized. Use --manifest-dir to process or --mode cleanup-staging to clean up.');
  }

  await flushManifestWriteBackQueue(writeBackQueue);
  await prisma.$disconnect();
}

// Only run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { processManifest, findPrimaryFile, cleanupStaging };
