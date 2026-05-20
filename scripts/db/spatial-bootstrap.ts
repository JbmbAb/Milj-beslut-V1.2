/**
 * scripts/db/spatial-bootstrap.ts
 *
 * Idempotent bootstrap för PostGIS-relaterade SQL-migrations som ligger
 * utanför Prisma's migrations-spår (prisma/spatial/*.sql). Skriver
 * resultat till spatial_migrations-tabellen för spårbarhet.
 *
 * Körs via: npm run db:spatial
 *
 * Ordning:
 *  1. Säkerställ att PostGIS/pg_trgm/unaccent-extensions finns.
 *  2. Säkerställ att spatial_migrations-tabellen finns (skapar den via
 *     rå SQL om Prisma generate inte har körts än).
 *  3. Applicera alla *.sql i prisma/spatial i lexikografisk ordning,
 *     skippa filer som redan loggats med samma checksum.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

const SPATIAL_DIR = resolve(process.cwd(), 'prisma', 'spatial');

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spatial_migrations (
      id            text PRIMARY KEY,
      "fileName"    text NOT NULL UNIQUE,
      checksum      text NOT NULL,
      "appliedAt"   timestamptz NOT NULL DEFAULT now(),
      "durationMs"  integer,
      note          text
    );
  `);
}

async function ensureExtensions(pool: Pool): Promise<void> {
  const extensions = ['postgis', 'pg_trgm', 'unaccent'];
  for (const ext of extensions) {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
  }
}

interface MigrationFile {
  fileName: string;
  fullPath: string;
  contents: string;
  checksum: string;
}

function loadMigrationFiles(): MigrationFile[] {
  const entries = readdirSync(SPATIAL_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const fullPath = join(SPATIAL_DIR, entry.name);
      const contents = readFileSync(fullPath, 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');
      return { fileName: entry.name, fullPath, contents, checksum };
    });
}

async function applyMigration(pool: Pool, file: MigrationFile): Promise<void> {
  const existing = await pool.query<{ checksum: string }>(
    'SELECT checksum FROM spatial_migrations WHERE "fileName" = $1',
    [file.fileName],
  );

  if (existing.rowCount && existing.rows[0].checksum === file.checksum) {
    console.log(`[=] ${file.fileName} (oförändrad, skippas)`);
    return;
  }

  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(file.contents);
    const duration = Date.now() - start;

    if (existing.rowCount) {
      await client.query(
        `UPDATE spatial_migrations
         SET checksum = $1, "appliedAt" = now(), "durationMs" = $2, note = 'reapplied'
         WHERE "fileName" = $3`,
        [file.checksum, duration, file.fileName],
      );
      console.log(`[~] ${file.fileName} (återapplicerad, ${duration}ms)`);
    } else {
      const id = `spatial_${file.fileName.replace(/\W+/g, '_')}`;
      await client.query(
        `INSERT INTO spatial_migrations (id, "fileName", checksum, "durationMs", note)
         VALUES ($1, $2, $3, $4, 'initial')`,
        [id, file.fileName, file.checksum, duration],
      );
      console.log(`[+] ${file.fileName} (applicerad, ${duration}ms)`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('FEL: DATABASE_URL saknas i miljön.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: connStr });

  try {
    console.log('PostGIS spatial bootstrap startar…');
    console.log(`Källkatalog: ${SPATIAL_DIR}`);
    await ensureExtensions(pool);
    await ensureMigrationsTable(pool);

    const files = loadMigrationFiles();
    if (files.length === 0) {
      console.warn('Inga SQL-filer hittades i prisma/spatial.');
      return;
    }

    for (const file of files) {
      await applyMigration(pool, file);
    }

    const { rows } = await pool.query<{
      fileName: string;
      appliedAt: string;
      durationMs: number | null;
    }>('SELECT "fileName", "appliedAt", "durationMs" FROM spatial_migrations ORDER BY "fileName"');
    console.log('\nAktuell spatial_migrations-status:');
    for (const row of rows) {
      console.log(`  ${row.fileName.padEnd(40)} ${row.appliedAt} (${row.durationMs ?? '—'}ms)`);
    }
    console.log('\nBootstrap klar.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('spatial-bootstrap fel:', err);
  process.exit(1);
});
