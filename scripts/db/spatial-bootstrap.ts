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
 *
 * U30F2 H2 (PRES-05): planera först. Varje fil som ska appliceras (ej loggad, eller ändrad checksumma)
 * klassas med den skyddade relationsgrindens klassificerare. En fil som skriver en skyddad relation
 * (t.ex. 004: DROP TABLE core.property_unit; 005/006: env.ebh_* / env.protected_area) eller kör SQL vars
 * mål inte är statiskt (001/002: EXECUTE format(...)) appliceras BARA i ett uttryckligt
 * initialiseringsläge (--init-new-database) på en databas som inte innehåller någon skyddad relation.
 * Annars appliceras ingenting alls (exit 1). Redan loggade filer med samma checksumma hoppas över som förut,
 * så en release mot en redan bootstrappad databas påverkas inte.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { analyzeSql, judgeWrites } from '../../packages/spatial-provider-postgis/src/ProtectedWriteClassifier';
import { PROTECTED_RELATIONS } from '../../packages/spatial-provider-postgis/src/ProtectedRelations';

// U30F2 H2: next to this script (not the caller's cwd), so a run from another directory reads the same files.
const SPATIAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'spatial');

/** The explicit initialisation mode: only for a NEW database that holds no protected relation. */
export const INIT_NEW_DATABASE_FLAG = '--init-new-database';
export const REJECT_SPATIAL_MIGRATION_TOUCHES_PROTECTED_RELATION = 'REJECT_SPATIAL_MIGRATION_TOUCHES_PROTECTED_RELATION';

async function tableHasColumn(pool: Pool, table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return Boolean(rows[0]?.exists);
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  const tableExists = await tableHasColumn(pool, 'spatial_migrations', 'id');
  if (!tableExists) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spatial_migrations (
        id            SERIAL PRIMARY KEY,
        "fileName"    VARCHAR(255) NOT NULL UNIQUE,
        checksum      TEXT,
        "appliedAt"   TIMESTAMPTZ DEFAULT now(),
        "durationMs"  INTEGER,
        note          TEXT
      );
    `);
    return;
  }

  if (!(await tableHasColumn(pool, 'spatial_migrations', 'checksum'))) {
    await pool.query(`ALTER TABLE spatial_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);
  }
  if (!(await tableHasColumn(pool, 'spatial_migrations', 'note'))) {
    await pool.query(`ALTER TABLE spatial_migrations ADD COLUMN IF NOT EXISTS note TEXT`);
  }
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

/** What a migration file writes in protected relations (or runs without a static target), per the gate's classifier. */
export function protectedWritesOf(contents: string): string[] {
  const verdict = judgeWrites(analyzeSql(contents));
  return [
    ...verdict.protectedWrites.map((p) => `${p.operation} ${p.relation}`),
    ...verdict.unresolved.map((u) => `${u.operation} (target not static)`),
  ];
}

async function isPending(pool: Pool, file: MigrationFile): Promise<boolean> {
  const existing = await pool.query<{ checksum: string | null }>('SELECT checksum FROM spatial_migrations WHERE "fileName" = $1', [file.fileName]);
  return !(existing.rowCount && existing.rows[0].checksum && existing.rows[0].checksum === file.checksum);
}

/** Every protected relation (and retained-staging schema) the database already holds. */
export async function presentProtectedRelations(pool: Pool): Promise<string[]> {
  const present: string[] = [];
  for (const r of PROTECTED_RELATIONS.relations) {
    const { rows } = await pool.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [r.relation]);
    if (rows[0]?.exists) present.push(r.relation);
  }
  for (const schema of PROTECTED_RELATIONS.retained_staging_schemas) {
    const { rows } = await pool.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists', [schema]);
    if (rows[0]?.exists) present.push(`${schema}.*`);
  }
  return present;
}

/**
 * Refuse the whole run (nothing applied) when a pending file writes a protected relation, unless this
 * is an explicit initialisation of a database that holds none.
 */
async function assertPendingFilesMayRun(pool: Pool, files: MigrationFile[], argv: readonly string[]): Promise<void> {
  const touching: string[] = [];
  for (const file of files) {
    if (!(await isPending(pool, file))) continue;
    const writes = protectedWritesOf(file.contents);
    if (writes.length > 0) touching.push(`${file.fileName} (${writes.join('; ')})`);
  }
  if (touching.length === 0) return;
  const present = await presentProtectedRelations(pool);
  if (argv.includes(INIT_NEW_DATABASE_FLAG) && present.length === 0) {
    console.log(`Initialiseringsläge (${INIT_NEW_DATABASE_FLAG}): databasen innehåller ingen skyddad relation; ${touching.length} fil(er) får skapa dem.`);
    return;
  }
  throw new Error(
    `${REJECT_SPATIAL_MIGRATION_TOUCHES_PROTECTED_RELATION}: pending spatial migration(s) write protected relations: ${touching.join(' | ')}. ` +
      (present.length > 0
        ? `protected relations present: ${present.join(', ')} -- never applied to a database that holds them (no override).`
        : `run with ${INIT_NEW_DATABASE_FLAG} only to initialise a NEW, empty database.`) +
      ' Nothing was applied.',
  );
}

async function applyMigration(pool: Pool, file: MigrationFile): Promise<void> {
  const existing = await pool.query<{ checksum: string | null }>(
    'SELECT checksum FROM spatial_migrations WHERE "fileName" = $1',
    [file.fileName],
  );

  if (existing.rowCount && existing.rows[0].checksum && existing.rows[0].checksum === file.checksum) {
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
      await client.query(
        `INSERT INTO spatial_migrations ("fileName", checksum, "durationMs", note)
         VALUES ($1, $2, $3, 'initial')`,
        [file.fileName, file.checksum, duration],
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

    // U30F2 H2: decided for ALL pending files before the first one is applied.
    await assertPendingFilesMayRun(pool, files, process.argv);

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
