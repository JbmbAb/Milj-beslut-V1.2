import * as fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { getTargetConfig } from './config/importRegistry';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const prisma = new PrismaClient();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const OGRINFO_PATH = process.env.OGRINFO_PATH || 'C:\\Program Files\\GDAL\\ogrinfo.exe';
const POSTGIS_CONTAINER = process.env.POSTGIS_CONTAINER || 'miljobeslut-postgres';
const POSTGIS_MOUNT_ROOT = process.env.POSTGIS_MOUNT_ROOT || '/mnt/drive'; // Path inside Docker container where H: is mounted

interface Manifest {
  provider: string;
  dataset: string;
  version: string;
  provenance: string;
  content_bundle_sha256: string;
  files: string[];
  total_bytes: number;
}

// Arguments
const args = process.argv.slice(2);
let manifestDir = '';
let dataDir = '';
let onlyHash = '';
let execute = false;
let mode = 'plan'; // 'plan' | 'import-staging' | 'promote'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest-dir') manifestDir = args[++i];
  if (args[i] === '--data-dir') dataDir = args[++i];
  if (args[i] === '--only') onlyHash = args[++i];
  if (args[i] === '--execute') execute = true;
  if (args[i] === '--mode') mode = args[++i];
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

async function processManifest(manifestPath: string) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest: Manifest = JSON.parse(raw);

    // Validate Schema
    if (!manifest.provider || !manifest.dataset || !manifest.content_bundle_sha256 || !manifest.files) {
      throw new Error(`Invalid manifest schema at ${manifestPath}`);
    }

    if (onlyHash && manifest.content_bundle_sha256 !== onlyHash) {
      return;
    }

    logger.info(`\n📦 Processing: ${manifest.provider} / ${manifest.dataset}`);

    // Import Registry lookup
    const targetConfig = getTargetConfig(manifest.provider, manifest.dataset);
    const { target_schema, target_table } = targetConfig;
    logger.info(`   Registry Target: ${target_schema}.${target_table}`);

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
          // raster2pgsql emits BEGIN; ... COMMIT; — split and run each statement
          const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(s => s.length > 0 && s !== 'BEGIN' && s !== 'COMMIT');
          for (const stmt of statements) {
            await prisma.$executeRawUnsafe(stmt + ';');
          }

        } else {
          // VECTOR FLOW
          // Validation: Verify source CRS via ogrinfo
          logger.info(`   - Verifying source CRS using ogrinfo...`);
          const ogrinfoResult = spawnSync(OGRINFO_PATH, ['-so', '-al', primaryFilePath], { encoding: 'utf-8' });
          
          if (ogrinfoResult.status !== 0) {
            throw new Error(`ogrinfo failed to read file. Status: ${ogrinfoResult.status}`);
          }

          const output = ogrinfoResult.stdout || '';
          // Look for typical CRS identifiers, e.g., "Coordinate System is:" or "PROJCRS"
          if (!output.includes('Coordinate System is:') && !output.includes('PROJCRS') && !output.includes('GEOGCRS')) {
            throw new Error(`Source file lacks a valid CRS. Cannot safely transform to EPSG:3006 without guessing.`);
          }

          const ogrArgs = [
            '-f', 'PostgreSQL',
            pgConn,
            primaryFilePath,
            '-nln', fullStagingTarget,
            '-overwrite',
            '-nlt', 'PROMOTE_TO_MULTI',
            '-lco', 'GEOMETRY_NAME=geom',
            '-lco', 'SPATIAL_INDEX=NONE', // Vi skapar GiST index manuellt efteråt
            '-t_srs', 'EPSG:3006',
          ];

          logger.info(`   - Running ogr2ogr to ${fullStagingTarget}...`);
          const result = spawnSync(OGR2OGR_PATH, ogrArgs, { stdio: 'inherit' });
          
          if (result.status !== 0) {
            throw new Error(`ogr2ogr failed with status ${result.status}`);
          }

          logger.info(`   - Creating GiST index and running VACUUM ANALYZE...`);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_${stagingTable}_geom ON ${stagingSchema}.${stagingTable} USING GIST (geom);`);
          try {
            await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${stagingSchema}.${stagingTable};`);
          } catch(e) {
             logger.warn(`Could not run VACUUM ANALYZE: ${(e as Error).message}`);
          }
        }

        await prisma.postgisImportBatch.update({
          where: { id: batch.id },
          data: { status: 'STAGING_IMPORTED' },
        });

        logger.info(`   ✅ Staging Import Successful.`);
      } catch (err: any) {
        await prisma.postgisImportBatch.update({
          where: { id: batch.id },
          data: { status: 'FAILED', error_message: err.message },
        });
        logger.error(`   ❌ Failed: ${err.message}`);
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
        logger.dry(`[promote] Would promote ${fullStagingTarget} to ${target_schema}.${target_table} using TRUNCATE + INSERT to preserve views.`);
        return;
      }

      logger.info(`   - Promoting ${fullStagingTarget} -> ${target_schema}.${target_table}...`);
      await prisma.postgisImportBatch.update({
        where: { id: stagedBatch.id },
        data: { status: 'PROMOTE_STARTED' },
      });

      try {
        // We use a transaction to ensure atomic promotion. 
        // This prevents the target table from being left empty if the process fails mid-way.
        await prisma.$transaction([
          prisma.$executeRawUnsafe(`TRUNCATE ${target_schema}.${target_table};`),
          prisma.$executeRawUnsafe(`INSERT INTO ${target_schema}.${target_table} SELECT * FROM ${stagingSchema}.${stagingTable};`)
        ]);
        
        await prisma.postgisImportBatch.update({
          where: { id: stagedBatch.id },
          data: { status: 'SUCCESS', completed_at: new Date() },
        });
        
        logger.info(`   ✅ Promote Successful (Atomic).`);
      } catch (err: any) {
        await prisma.postgisImportBatch.update({
          where: { id: stagedBatch.id },
          data: { status: 'FAILED', error_message: `Promote failed: ${err.message}` },
        });
        logger.error(`   ❌ Promote Failed: ${err.message}`);
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
    const files = fs.readdirSync(manifestDir).filter(f => f.endsWith('.json') && !f.includes('local_master_index'));
    for (const file of files) {
      await processManifest(path.join(manifestDir, file));
    }
  } else {
    // If running as a test/imported module, do nothing.
    logger.info('Unified Ingester initialized. Use --manifest-dir to process or --mode cleanup-staging to clean up.');
  }
  
  await prisma.$disconnect();
}

// Only run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { processManifest, findPrimaryFile };
