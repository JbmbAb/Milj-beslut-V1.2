import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchored to this module's own location (scripts/db/lib/ -> repo root), not process.cwd().
// A caller may legitimately run with a different cwd -- e.g.
// tests/unit/requiredSpatialExtensions.test.ts mocks process.cwd() to a temp directory to
// exercise applyGisTestStubs()'s destructive-path CONTROL in isolation. Resolving against
// cwd made file lookup fail under that mock; this file's own path never moves.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * RC6-E — makes the versioned spatial DDL chain (prisma/spatial/*.sql) the single schema
 * authority for the objects RC6 owns, instead of each test provisioner hand-duplicating the
 * same CREATE TABLE statements as a second, independently-maintained definition.
 *
 * Before this: scripts/db/provision-spatial-test-db.ts and tests/setup/seedGisStubs.ts each
 * carried their own hand-written DDL for these three objects. They happened to agree after
 * RC6-A/B/C/D, but "happen to agree" is not schema authority — SPATIAL-SCHEMA-OWNERSHIP-01.md's
 * whole point is that env is owned by this versioned chain, not by whoever last edited a test
 * provisioner. Both callers now execute the same files instead of maintaining parallel copies.
 *
 * Deliberately scoped to only the two files RC6 actually froze -- not the whole
 * prisma/spatial/*.sql chain. Other objects in that directory (e.g. core.property_unit,
 * env.kulturmiljo_omrade) remain hand-duplicated in the provisioners; that is documented,
 * pre-existing schema-ownership debt, out of scope for RC6-E.
 */
const RC6_OWNED_DDL_FILES = [
  'prisma/spatial/005_ebh_potentiellt_fororenade_omraden.sql',
  'prisma/spatial/006_protected_area_physical_boundary.sql',
] as const;

/** The physical tables those two files create. Used by callers for verification/logging. */
export const RC6_OWNED_TABLES = [
  'ebh_potentiellt_fororenade_omraden',
  'protected_area_nvr_raw',
  'protected_area',
] as const;

/** Structural type so this has no hard dependency on which 'pg' import shape a caller uses. */
export type SqlExecutor = { query(sql: string): Promise<unknown> };

export async function applyRc6VersionedSpatialDdl(client: SqlExecutor): Promise<void> {
  for (const file of RC6_OWNED_DDL_FILES) {
    const sql = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    await client.query(sql);
  }
}
