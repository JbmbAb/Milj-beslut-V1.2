import {
  evaluateDatabaseUrl,
  isRemoteManagedDatabaseUrl,
  isWorkstationHost,
  TEST_DATABASE_OPT_IN_ENV,
  TEST_DB_GUARD_LABEL,
  TestDatabaseTargetRefusedError,
} from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5) for local Playwright E2E (playwright.config.ts). Pure: reads only the
 * environment it is given, never an env file, never a socket.
 *
 * A local E2E run
 *   - needs an explicitly opted-in disposable database: MIMER_TEST_DB_ALLOW=<db>, <db> ends in
 *     _test and is exactly the database of PLAYWRIGHT_DATABASE_URL / DATABASE_URL, taken from the
 *     process environment only. An explicitly dead target is NOT enough here: the run writes
 *     through its API server, so it either has its own disposable database or it does not run;
 *   - always starts its own fresh API and UI servers (never reuses a running one) on its own ports,
 *     never on a port of the local demonstrator (whose API server runs on the live database);
 *   - hands the server the checked URL together with MIMER_TEST_MODE=1, so the server keeps it and
 *     reads no env file at all (server/loadEnvFirst.ts, server/loadEnv.ts).
 * An external target (PLAYWRIGHT_BASE_URL / STAGING_URL) starts no server, and must not be this
 * workstation: that would reuse a running local server -- e.g. the demonstrator on the live DB.
 */

/** Never 8787: that is the local demonstrator's API server, which runs on the live database. */
export const LOCAL_E2E_DEFAULT_API_PORT = 18787;
export const LOCAL_E2E_DEFAULT_UI_PORT = 3200;

/** Ports a local E2E server must never use: they belong to the running local demonstrator. */
export const LOCAL_E2E_RESERVED_PORTS: Readonly<Record<number, string>> = {
  8787: 'the local demonstrator API server (live database)',
  5173: 'the local demonstrator UI (Vite)',
  3000: "vite.config.ts's default dev server port",
};

/** The keys that point an E2E run at an already running server (tests/e2e/support.ts). */
export const EXTERNAL_E2E_TARGET_KEYS: readonly string[] = [
  'PLAYWRIGHT_BASE_URL',
  'STAGING_URL',
  'PLAYWRIGHT_API_BASE_URL',
  'STAGING_API_BASE_URL',
];

const VIA = 'playwright.config.ts (local E2E)';

export type LocalE2eServerPlan = {
  readonly apiPort: number;
  readonly uiPort: number;
  /** The checked URL; the API server and the test workers get exactly this one. */
  readonly databaseUrl: string;
  /** The MIMER_TEST_DB_ALLOW value the URL was admitted under. */
  readonly databaseOptIn: string;
};

export class LocalE2eServerRefusedError extends Error {
  readonly code = 'TEST_DB_GUARD_REFUSED';

  constructor(reason: string) {
    super(`${TEST_DB_GUARD_LABEL} refused ${VIA}: ${reason}. No server was started or reused.`);
    this.name = 'LocalE2eServerRefusedError';
  }
}

function trim(value: string | undefined): string {
  return String(value ?? '').trim();
}

function portFrom(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = trim(env[key]);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw new LocalE2eServerRefusedError(`${key}=${JSON.stringify(raw)} is not a TCP port`);
  }
  return Number(raw);
}

/** Throws unless a local E2E run may start; returns the ports and the admitted database URL. */
export function resolveLocalE2eServerPlan(env: NodeJS.ProcessEnv): LocalE2eServerPlan {
  const apiPort = portFrom(env, 'PLAYWRIGHT_LOCAL_API_PORT', LOCAL_E2E_DEFAULT_API_PORT);
  const uiPort = portFrom(env, 'PLAYWRIGHT_LOCAL_UI_PORT', LOCAL_E2E_DEFAULT_UI_PORT);
  for (const [key, port] of [
    ['PLAYWRIGHT_LOCAL_API_PORT', apiPort],
    ['PLAYWRIGHT_LOCAL_UI_PORT', uiPort],
  ] as const) {
    const reserved = LOCAL_E2E_RESERVED_PORTS[port];
    if (reserved) {
      throw new LocalE2eServerRefusedError(
        `${key} resolves to port ${port}, which is ${reserved}; a local E2E run always starts its own ` +
          `fresh server on a port of its own (default API ${LOCAL_E2E_DEFAULT_API_PORT}, UI ${LOCAL_E2E_DEFAULT_UI_PORT})`,
      );
    }
  }
  if (apiPort === uiPort) {
    throw new LocalE2eServerRefusedError(`the API and UI servers cannot share port ${apiPort}`);
  }

  const databaseUrl = trim(env.PLAYWRIGHT_DATABASE_URL) || trim(env.DATABASE_URL);
  if (!databaseUrl) {
    throw new TestDatabaseTargetRefusedError(
      VIA,
      'no database',
      'PLAYWRIGHT_DATABASE_URL / DATABASE_URL is not set in the process environment (a local E2E run ' +
        'never takes its database from an env file)',
    );
  }
  if (isRemoteManagedDatabaseUrl(databaseUrl)) {
    throw new TestDatabaseTargetRefusedError(
      VIA,
      'a remote managed database (prisma://)',
      'a local E2E run never uses a remote managed database',
    );
  }
  // Every target the URL can reach (pg, libpq, PG* fallbacks; every spelling of every host).
  const verdict = evaluateDatabaseUrl(databaseUrl, env);
  if (!verdict.allowed) {
    throw new TestDatabaseTargetRefusedError(VIA, verdict.target, verdict.reason);
  }
  if (verdict.basis !== 'explicit-opt-in') {
    throw new TestDatabaseTargetRefusedError(
      VIA,
      verdict.target,
      `${verdict.reason}, but a local E2E run writes through its own API server and needs an opted-in ` +
        `disposable database: set ${TEST_DATABASE_OPT_IN_ENV}=<database> naming a *_test database`,
    );
  }
  return { apiPort, uiPort, databaseUrl, databaseOptIn: trim(env[TEST_DATABASE_OPT_IN_ENV]) };
}

/** Throws when an external E2E target points at this workstation (a running local server). */
export function assertExternalE2eTargetsAreRemote(env: NodeJS.ProcessEnv): void {
  for (const key of EXTERNAL_E2E_TARGET_KEYS) {
    const value = trim(env[key]);
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new LocalE2eServerRefusedError(`${key} is not a URL`);
    }
    if (isWorkstationHost(parsed.hostname)) {
      throw new LocalE2eServerRefusedError(
        `${key} points at this workstation (${parsed.host}); an external E2E target would reuse a ` +
          `running local server such as the demonstrator on the live database. Unset it: the local ` +
          `E2E harness starts its own fresh servers on an opted-in *_test database`,
      );
    }
  }
}
