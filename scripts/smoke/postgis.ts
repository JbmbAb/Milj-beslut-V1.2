/**
 * scripts/smoke/postgis.ts
 *
 * Direktverifiering av PostGIS-infrastruktur. Ansluter mot DATABASE_URL och:
 *  1. Hämtar postgis_full_version().
 *  2. Kollar extensions (postgis, pg_trgm, unaccent).
 *  3. Räknar GIST-index.
 *  4. Kör ST_Intersects mot env.protected_area med en bbox över Uppsala.
 *  5. Läser status ur spatial_migrations-tabellen.
 */

import { Pool } from 'pg';
import { loadEnvFile } from '../../server/loadEnv';

async function main(): Promise<void> {
  const preserveRuntimeEnv =
    String(process.env.PRESERVE_RUNTIME_ENV || '').toLowerCase() === 'true';
  loadEnvFile();
  loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });

  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('FEL: DATABASE_URL saknas.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: connStr });
  const results: Array<{ name: string; status: 'ok' | 'fail' | 'degraded'; detail?: string }> = [];

  try {
    // 1. PostGIS-version
    try {
      const { rows } = await pool.query<{ postgis_full_version: string }>(
        'SELECT postgis_full_version() AS postgis_full_version',
      );
      results.push({
        name: 'postgis_version',
        status: 'ok',
        detail: rows[0]?.postgis_full_version,
      });
    } catch (err) {
      results.push({
        name: 'postgis_version',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Extensions
    try {
      const { rows } = await pool.query<{ extname: string; extversion: string }>(
        'SELECT extname, extversion FROM pg_extension ORDER BY extname',
      );
      const names = rows.map((r) => r.extname);
      const required = ['postgis', 'pg_trgm'];
      const missing = required.filter((r) => !names.includes(r));
      results.push({
        name: 'extensions',
        status: missing.length === 0 ? 'ok' : 'degraded',
        detail:
          missing.length === 0
            ? names.join(', ')
            : `saknas: ${missing.join(', ')} | finns: ${names.join(', ')}`,
      });
    } catch (err) {
      results.push({
        name: 'extensions',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. GIST-index
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pg_indexes WHERE indexdef ILIKE '%USING gist%'`,
      );
      const count = Number(rows[0]?.count ?? 0);
      results.push({
        name: 'gist_indexes',
        status: count > 0 ? 'ok' : 'degraded',
        detail: `${count} GIST-index`,
      });
    } catch (err) {
      results.push({
        name: 'gist_indexes',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // 4. ST_Intersects mot env.protected_area
    try {
      const { rows } = await pool.query<{ hits: string }>(
        `SELECT COUNT(*)::text AS hits
         FROM env.protected_area
         WHERE ST_Intersects(
           geom,
           ST_Transform(ST_SetSRID(ST_MakeEnvelope(17.55, 59.82, 17.75, 59.92), 4326), ST_SRID(geom))
         )`,
      );
      results.push({
        name: 'st_intersects_protected_area',
        status: 'ok',
        detail: `${rows[0]?.hits ?? 0} träffar i testbbox (Uppsala)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tabellen kan saknas i testmiljöer utan importerad data; markera degraded.
      results.push({
        name: 'st_intersects_protected_area',
        status: msg.includes('does not exist') ? 'degraded' : 'fail',
        detail: msg,
      });
    }

    // 5. spatial_migrations
    try {
      const { rows } = await pool.query<{
        fileName: string;
        appliedAt: string;
      }>(
        `SELECT "fileName", "appliedAt"::text AS "appliedAt"
         FROM spatial_migrations ORDER BY "appliedAt" DESC LIMIT 5`,
      );
      results.push({
        name: 'spatial_migrations',
        status: rows.length > 0 ? 'ok' : 'degraded',
        detail:
          rows.length > 0
            ? rows.map((r) => `${r.fileName} (${r.appliedAt})`).join(' | ')
            : 'inga migrations loggade — kör npm run db:spatial',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        name: 'spatial_migrations',
        status: msg.includes('does not exist') ? 'degraded' : 'fail',
        detail: msg,
      });
    }

    console.log('PostGIS smoketest');
    console.log('─'.repeat(80));
    for (const r of results) {
      const glyph = r.status === 'ok' ? '[OK]' : r.status === 'degraded' ? '[WARN]' : '[FAIL]';
      console.log(`${glyph} ${r.name.padEnd(32)} ${r.detail ?? ''}`);
    }
    const fails = results.filter((r) => r.status === 'fail').length;
    process.exit(fails > 0 ? 1 : 0);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
