import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';

// Target tables and their configurations
const TARGETS = {
  ground_layer: {
    table: 'env.sgu_ground_layer',
    indexName: 'sgu_ground_layer_geom_idx',
    geomCol: 'geom',
  },
  landslide: {
    table: 'env.sgu_landslide_feature',
    indexName: 'sgu_landslide_geom_idx',
    geomCol: 'geom',
  },
};

async function runBulkImport(filePath: string, targetKey: keyof typeof TARGETS) {
  const config = TARGETS[targetKey];
  if (!config) throw new Error(`Invalid target: ${targetKey}`);

  console.log(`\n🚀 STARTING BULK IMPORT: ${filePath} -> ${config.table}`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  try {
    // 1. Pre-optimization: Drop index and disable autovacuum
    console.log(`Step 1/4: Optimizing database for write speed...`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${config.table}_${config.geomCol}_idx;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE ${config.table} SET (autovacuum_enabled = false);`);

    // 2. Build ogr2ogr command
    // We parse the DATABASE_URL to get individual components for the PG: connection string
    const url = new URL(DATABASE_URL);
    const dbname = url.pathname.slice(1);
    const host = url.hostname;
    const user = url.username;
    const password = url.password;
    const port = url.port || '5432';

    const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

    // Command flags:
    // -append: Add to existing table
    // -gt 65536: Group 64k rows per transaction (CRITICAL for speed)
    // -nlt PROMOTE_TO_MULTI: Ensure MultiPolygon/MultiLineString
    // -lco GEOMETRY_NAME=geom: Set correct geometry column name
    // -skipfailures: Don't stop on single row errors
    const ogrCmd =
      `ogr2ogr -f PostgreSQL "${pgConn}" "${filePath}" ` +
      `-nln ${config.table} -append -gt 65536 -nlt PROMOTE_TO_MULTI ` +
      `-lco GEOMETRY_NAME=${config.geomCol} -lco SPATIAL_INDEX=NONE -skipfailures`;

    console.log(`Step 2/4: Running ogr2ogr bulk stream...`);
    console.log(`Command: ${ogrCmd.replace(password, '****')}`);

    execSync(ogrCmd, { stdio: 'inherit' });

    // 3. Post-optimization: Re-enable autovacuum and REBUILD INDEX
    console.log(`Step 3/4: Re-enabling autovacuum...`);
    await prisma.$executeRawUnsafe(`ALTER TABLE ${config.table} SET (autovacuum_enabled = true);`);

    console.log(`Step 4/4: Rebuilding spatial index (this might take a while for 93M rows)...`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS ${config.table.replace('.', '_')}_${config.geomCol}_idx ON ${config.table} USING GIST (${config.geomCol});`,
    );

    console.log(`✅ Bulk import completed successfully.`);

    // 4. Final Vacuum Analyze
    console.log(`Running VACUUM ANALYZE...`);
    await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${config.table};`);
  } catch (error) {
    console.error(`❌ Bulk import failed:`, error);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI usage: npx tsx scripts/import/bulk-import-sgu.ts <path_to_file> <target_key>
const [, , filePath, targetKey] = process.argv;

if (!filePath || !targetKey) {
  console.log('Usage: npx tsx scripts/import/bulk-import-sgu.ts <path_to_file> <ground_layer|landslide>');
  process.exit(1);
}

runBulkImport(filePath, targetKey as any);
