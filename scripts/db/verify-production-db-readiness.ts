/**
 * Verify production/staging DB readiness without starting the web server.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/db/verify-production-db-readiness.ts
 */
import { Pool } from 'pg';

import { verifyProductionDatabaseReadiness } from './lib/productionDatabaseReadiness';

async function main(): Promise<void> {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const readiness = await verifyProductionDatabaseReadiness(pool);
    console.log(JSON.stringify({ ok: true, ...readiness }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('verify-production-db-readiness failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
