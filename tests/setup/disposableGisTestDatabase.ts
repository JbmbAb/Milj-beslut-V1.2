import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * DB-0-SAFETY — Prevent test GIS seeding from targeting production.
 *
 * Destructive GIS test setup (DROP EXTENSION / DROP SCHEMA / DROP TABLE) must positively
 * prove that its target is an approved disposable test database before any connection is
 * opened. Admission model C: a repository allowlist AND an explicit environment admission
 * must independently agree with the database actually named by DATABASE_URL.
 *
 *     actual target  <->  explicit environment admission  <->  repository allowlist
 *
 * A stale flag alone, or a mistaken .env alone, is therefore not sufficient to reach DDL.
 */

/**
 * Databases this repository admits for destructive test use. Authority, not convenience.
 * `miljobeslut_test` is the name documented in .env.test.example; `riskguard_test` is the
 * name in use locally. Note that the production name `miljobeslut` is a strict prefix of
 * `miljobeslut_test` — every comparison here is exact, never prefix-based.
 */
export const DISPOSABLE_TEST_DATABASE_ALLOWLIST: readonly string[] = [
  'riskguard_test',
  'miljobeslut_test',
];

/** Hosts on which destructive test setup may run at all. */
export const DISPOSABLE_TEST_HOST_ALLOWLIST: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '::1',
];

/**
 * Defense in depth only. The authority is the allowlist plus the explicit admission above;
 * this list exists so a known production name fails loudly even if an allowlist is widened.
 */
export const KNOWN_PRODUCTION_DATABASE_NAMES: readonly string[] = ['miljobeslut'];

export type DisposableGisTestDatabaseConfig = {
  /** Raw DATABASE_URL as resolved from the explicit test environment, if present at all. */
  readonly databaseUrl: string | undefined;
  /** Value of GIS_TEST_DB_DISPOSABLE, if present at all. */
  readonly disposableFlag: string | undefined;
  /** Value of GIS_TEST_DB_NAME, if present at all. */
  readonly declaredDatabaseName: string | undefined;
  /** Whether the explicit test environment file was found. */
  readonly envTestPresent: boolean;
};

export class DisposableGisTestDatabaseError extends Error {
  constructor(reason: string) {
    super(
      `DB-0-SAFETY refused destructive GIS test setup: ${reason}. ` +
        `No database connection was opened and no SQL was executed. ` +
        `Destructive setup requires .env.test to declare a DATABASE_URL naming a database ` +
        `that is on the repository allowlist (${DISPOSABLE_TEST_DATABASE_ALLOWLIST.join(', ')}), ` +
        `together with GIS_TEST_DB_DISPOSABLE=1 and a matching GIS_TEST_DB_NAME.`,
    );
    this.name = 'DisposableGisTestDatabaseError';
  }
}

export type AdmittedDisposableGisTestDatabase = {
  readonly databaseUrl: string;
  readonly databaseName: string;
  readonly host: string;
};

/**
 * Fail-closed admission check. Pure: it performs no I/O and opens no connection, so the
 * full rejection matrix can be proven without a database.
 *
 * Throws {@link DisposableGisTestDatabaseError} unless every clause of the frozen contract holds.
 */
export function assertDisposableGisTestDatabase(
  config: DisposableGisTestDatabaseConfig,
): AdmittedDisposableGisTestDatabase {
  // Clause: no fallback from an absent explicit test environment to a production-capable one.
  if (!config.envTestPresent) {
    throw new DisposableGisTestDatabaseError('.env.test is absent, and .env is never a fallback here');
  }

  // Clause 1: DATABASE_URL exists and parses.
  const rawUrl = (config.databaseUrl ?? '').trim();
  if (!rawUrl) {
    throw new DisposableGisTestDatabaseError('DATABASE_URL is missing or empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DisposableGisTestDatabaseError('DATABASE_URL could not be parsed as a URL');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).trim();
  const host = parsed.hostname;

  if (!databaseName) {
    throw new DisposableGisTestDatabaseError('DATABASE_URL names no database');
  }

  // Clause 2: host explicitly allowed for destructive test use.
  if (!DISPOSABLE_TEST_HOST_ALLOWLIST.includes(host)) {
    throw new DisposableGisTestDatabaseError(
      `host ${JSON.stringify(host)} is not allowed for destructive test use`,
    );
  }

  // Clause 6: never a known production name, checked before the allowlist so that a
  // widened allowlist cannot silently admit production.
  if (KNOWN_PRODUCTION_DATABASE_NAMES.includes(databaseName)) {
    throw new DisposableGisTestDatabaseError(
      `database ${JSON.stringify(databaseName)} is a known production database`,
    );
  }

  // Clause 3: database name explicitly allowlisted by the repository.
  if (!DISPOSABLE_TEST_DATABASE_ALLOWLIST.includes(databaseName)) {
    throw new DisposableGisTestDatabaseError(
      `database ${JSON.stringify(databaseName)} is not on the disposable allowlist`,
    );
  }

  // Clause 4: explicit disposable admission present.
  if ((config.disposableFlag ?? '').trim() !== '1') {
    throw new DisposableGisTestDatabaseError('GIS_TEST_DB_DISPOSABLE=1 is not set');
  }

  // Clause 5: the admission names the same database that is actually targeted.
  const declaredName = (config.declaredDatabaseName ?? '').trim();
  if (!declaredName) {
    throw new DisposableGisTestDatabaseError('GIS_TEST_DB_NAME is not set');
  }
  if (declaredName !== databaseName) {
    throw new DisposableGisTestDatabaseError(
      `GIS_TEST_DB_NAME ${JSON.stringify(declaredName)} does not name the targeted database ` +
        `${JSON.stringify(databaseName)}`,
    );
  }

  return { databaseUrl: rawUrl, databaseName, host };
}

/**
 * Reads the explicit test environment only. Deliberately does not call dotenv.config(),
 * because loading .env here is exactly how the destructive path could reach production.
 */
export function resolveDisposableGisTestConfig(
  cwd: string = process.cwd(),
): DisposableGisTestDatabaseConfig {
  const envTestPath = path.resolve(cwd, '.env.test');
  const envTestPresent = fs.existsSync(envTestPath);
  const parsed = envTestPresent ? dotenv.parse(fs.readFileSync(envTestPath)) : {};

  // process.env wins only where the explicit file is silent, mirroring dotenv override:false.
  return {
    envTestPresent,
    databaseUrl: process.env.DATABASE_URL ?? parsed.DATABASE_URL,
    disposableFlag: process.env.GIS_TEST_DB_DISPOSABLE ?? parsed.GIS_TEST_DB_DISPOSABLE,
    declaredDatabaseName: process.env.GIS_TEST_DB_NAME ?? parsed.GIS_TEST_DB_NAME,
  };
}

/**
 * Single entry point for the destructive setup path. Resolves the explicit test environment,
 * admits or refuses, and on success publishes the admitted URL so downstream clients cannot
 * connect to a different database than the one that was checked.
 */
export function admitDisposableGisTestDatabase(
  cwd: string = process.cwd(),
): AdmittedDisposableGisTestDatabase {
  const admitted = assertDisposableGisTestDatabase(resolveDisposableGisTestConfig(cwd));
  process.env.DATABASE_URL = admitted.databaseUrl;
  return admitted;
}
