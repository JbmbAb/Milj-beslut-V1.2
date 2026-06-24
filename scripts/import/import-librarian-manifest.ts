import * as fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { getRegistryEntry } from './config/importRegistry';
import {
  assertExpectedColumnsPresent,
  assertStagingQaPasses,
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

dotenv.config();

const prisma = new PrismaClient();

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

const writeBackQueue: Array<Promise<{ ok: boolean; remotePath: string; error?: string }>> = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest-dir') manifestDir = args[++i];
  if (args[i] === '--data-dir') dataDir = args[++i];
  if (args[i] === '--only') onlyHash = args[++i];
  if (args[i] === '--execute') execute = true;
  if (args[i] === '--mode') mode = args[++i];
  if (args[i] === '--write-back-manifest') writeBackManifest = true;
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
      throw new Error(`Invalid manifest schema at ${manifestPath}: ${validated.errors.join('; ')}`);
    }
    const manifest: Manifest = validated.manifest;

    if (!isImportEligible(manifest)) {
      throw new Error(
        `Manifest ${manifestPath} is not import-eligible (qa_status=${readQaStatus(manifest)})`,
      );
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

    if (existingSuccess) {
      logger.info(`   ⏭️ SKIPPED (Already imported successfully in batch ${existingSuccess.id})`);
      return;
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
          const ogrinfoResult = spawnSync(OGRINFO_PATH, ogrinfoArgs, { encoding: 'utf-8' });
          
          if (ogrinfoResult.status !== 0) {
            throw new Error(`ogrinfo failed to read file. Status: ${ogrinfoResult.status}`);
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
          const ogrArgs = [
            '-f', 'PostgreSQL',
            pgConn,
            primaryFilePath,
            ...(ogrLayer ? [ogrLayer] : []),
            '-nln', fullStagingTarget,
            '-overwrite',
            '-nlt', 'PROMOTE_TO_MULTI',
            '-lco', 'GEOMETRY_NAME=geom',
            '-lco', 'SPATIAL_INDEX=NONE', // Vi skapar GiST index manuellt efteråt
            '-t_srs', 'EPSG:3006',
            '-gt', '65536',
            '--config', 'PG_USE_COPY', 'YES',
          ];

          logger.info(`   - Running ogr2ogr to ${fullStagingTarget}...`);
          const result = spawnSync(OGR2OGR_PATH, ogrArgs, {
            stdio: 'inherit',
            env: { ...process.env, PGOPTIONS: OGR2OGR_PGOPTIONS },
          });
          
          if (result.status !== 0) {
            throw new Error(`ogr2ogr failed with status ${result.status}`);
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
          await prisma.$transaction([
            prisma.$executeRawUnsafe(`TRUNCATE ${target_schema}.${target_table};`),
            prisma.$executeRawUnsafe(insertSql),
          ]);
        } else {
          logger.info(`   - Prod table missing — bootstrapping from staging...`);
          await prisma.$executeRawUnsafe(
            `CREATE TABLE ${target_schema}.${target_table} AS SELECT * FROM ${stagingSchema}.${stagingTable}`,
          );
        }

        const prodRowsAfter = await countTableRows(prisma, `${target_schema}.${target_table}`);
        if (prodRowsAfter !== stagingRows) {
          throw new Error(
            `Promote audit failed: staging=${stagingRows}, prod_after=${prodRowsAfter}`,
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
      }
    } else {
       logger.warn(`Unknown mode: ${mode}`);
    }

  } catch (err: any) {
    logger.error(`Failed to process manifest ${manifestPath}: ${err.message}`);
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

  for (const batch of badBatches) {
    const shortHash = batch.content_bundle_sha256.substring(0, 8);
    const stagingTable = `lm_staging.${batch.target_table}_${shortHash}`;
    
    if (!execute) {
      logger.dry(`[cleanup-staging] Would run DROP TABLE IF EXISTS ${stagingTable} (Batch ID: ${batch.id}, Status: ${batch.status})`);
    } else {
      logger.info(`   - Dropping ${stagingTable}...`);
      try {
         await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${stagingTable};`);
         logger.info(`   ✅ Dropped ${stagingTable}`);
      } catch (err: any) {
         logger.error(`   ❌ Failed to drop ${stagingTable}: ${err.message}`);
      }
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
    const files = fs
      .readdirSync(manifestDir)
      .filter(
        (f) =>
          f.endsWith('.json') &&
          !f.includes('local_master_index') &&
          !f.startsWith('merge-') &&
          f !== 'checksums.txt',
      );
    if (files.length === 0 && fs.existsSync(path.join(manifestDir, 'manifest.json'))) {
      await processManifest(path.join(manifestDir, 'manifest.json'));
    } else {
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
  main();
}

export { processManifest, findPrimaryFile };
