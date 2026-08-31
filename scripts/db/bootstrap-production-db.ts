/**
 * Production/staging database bootstrap (PNRC I2).
 *
 * Deterministic fresh-database path:
 *   1. operator gate (DB_BOOTSTRAP_CONFIRM=yes)
 *   2. ensure required extensions
 *   3. prisma migrate deploy
 *   4. spatial-bootstrap (prisma/spatial/*.sql)
 *   5. sovereign readiness verification (core/env + spatial_ref_sys)
 *
 * Usage:
 *   DB_BOOTSTRAP_CONFIRM=yes DATABASE_URL=... npm run db:bootstrap
 */
import { execSync } from 'node:child_process';
import { Pool } from 'pg';

import { verifyProductionDatabaseReadiness } from './lib/productionDatabaseReadiness';
import { resolveBootstrapDatabaseTarget } from './resolveBootstrapDatabaseTarget';

const PRODUCTION_EXTENSIONS = [
  'postgis',
  'postgis_raster',
  'vector',
  'pg_trgm',
  'unaccent',
] as const;

export async function ensureProductionDatabaseExtensions(pool: Pool): Promise<void> {
  for (const extension of PRODUCTION_EXTENSIONS) {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`);
  }
}

export async function runProductionDatabaseBootstrap(): Promise<void> {
  const target = resolveBootstrapDatabaseTarget(process.env);
  console.log(`Database bootstrap starting for database: ${target.databaseName}`);

  const pool = new Pool({ connectionString: target.databaseUrl });
  try {
    await ensureProductionDatabaseExtensions(pool);
    console.log('Extensions ensured.');
  } finally {
    await pool.end();
  }

  execSync('npx --no-install prisma migrate deploy', { stdio: 'inherit' });
  execSync('npx --no-install tsx scripts/db/spatial-bootstrap.ts', { stdio: 'inherit' });

  const verifyPool = new Pool({ connectionString: target.databaseUrl });
  try {
    const readiness = await verifyProductionDatabaseReadiness(verifyPool);
    console.log(
      `Readiness OK: PostGIS=${readiness.postgisVersion}, schemas=${readiness.schemas.join(', ')}, spatial_ref_sys=${readiness.spatialRefCount}`,
    );
  } finally {
    await verifyPool.end();
  }

  console.log('Database bootstrap complete.');
}

async function main(): Promise<void> {
  await runProductionDatabaseBootstrap();
}

main().catch((err) => {
  console.error('bootstrap-production-db failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
