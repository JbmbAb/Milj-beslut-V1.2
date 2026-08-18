/**
 * GIS_TEST_DB_EXTENSION_OWNERSHIP-01 — extensions are a provisioning concern, not a test one.
 *
 * The per-test setup used to run `DROP EXTENSION postgis CASCADE` followed by
 * `CREATE EXTENSION postgis` on every run. Neither statement is available to the test role:
 * postgis and postgis_raster are not trusted extensions in PostgreSQL 16, so creating them
 * requires superuser, and dropping them requires extension ownership. On this machine the
 * extensions happened to be owned by the production role, which is exactly the accidental
 * ownership the test setup must not depend on.
 *
 * So the runtime no longer manages the extension lifecycle at all. It verifies that the
 * required extensions are present and fails with a provisioning instruction if they are not.
 * Creating them is the one-time job of scripts/db/provision-spatial-test-db.ts, which runs as
 * the admin role against the disposable test database only.
 */

/** Extensions the destructive schema reset and the spatial proofs depend on. */
export const REQUIRED_SPATIAL_EXTENSIONS: readonly string[] = [
  'postgis',
  'postgis_raster',
  'unaccent',
  'pg_trgm',
];

export class MissingSpatialExtensionsError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[], databaseName: string) {
    super(
      `GIS_TEST_DB_EXTENSION_OWNERSHIP-01: the test database ${JSON.stringify(databaseName)} is ` +
        `missing required extension(s): ${missing.join(', ')}. No schema was dropped and no ` +
        `table was modified. Extensions are provisioned once by the admin role, not by the test ` +
        `run, because postgis and postgis_raster are not trusted extensions and cannot be ` +
        `created by the test role. Provision the database first:\n\n` +
        `    npx tsx scripts/db/provision-spatial-test-db.ts\n`,
    );
    this.name = 'MissingSpatialExtensionsError';
    this.missing = missing;
  }
}

/** Narrow structural type so this can be proven without a real pg Client. */
export type ExtensionQueryable = {
  query(sql: string): Promise<{ rows: Array<{ extname: string }> }>;
};

/**
 * Verifies that every required extension is installed. Throws
 * {@link MissingSpatialExtensionsError} before the caller performs any destructive work.
 *
 * Read-only: it issues a single SELECT against pg_extension and never creates, drops or
 * alters anything.
 */
export async function assertRequiredSpatialExtensions(
  client: ExtensionQueryable,
  databaseName: string,
): Promise<void> {
  const result = await client.query('SELECT extname FROM pg_extension');
  const installed = new Set(result.rows.map((row) => row.extname));
  const missing = REQUIRED_SPATIAL_EXTENSIONS.filter((name) => !installed.has(name));

  if (missing.length > 0) {
    throw new MissingSpatialExtensionsError(missing, databaseName);
  }
}
