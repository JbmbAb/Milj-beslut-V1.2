import os from 'node:os';
import path from 'node:path';

/**
 * TEST-DB-GUARD (OD-K0-5). Pure policy: which database a TEST RUNTIME may reach, and which env
 * file content a test runtime may load. No I/O except reading the local interface list and a
 * one-line stderr notice, no connection, no import of a database client -- so it is safe to
 * import from the env loader and provable without a database.
 *
 * Why this exists: `server/loadEnvFirst.ts` deleted DATABASE_URL and refilled it from `.env.local`
 * in the current working directory, and in a developer worktree `.env.local` names the LIVE
 * database. A dead DATABASE_URL in the shell therefore did not protect a test run whose cwd was
 * the worktree (two incidents, see M1a). This module is the single policy behind four layers:
 *
 *   1. env loading     -- `server/loadEnv.ts` and the dotenv guard never load `*.local` env files
 *                         and never take database connection settings from any env file;
 *   2. startup check   -- every Vitest worker refuses to start a test file when the environment
 *                         names a known live/staging database (tests/setup/testDatabaseGuard.ts);
 *   3. connect check   -- every pg.Client/pg.Pool (and so every Prisma adapter-pg) connection in a
 *                         test runtime is refused unless the target is explicitly dead or opted
 *                         in, before any socket is opened (installTestDatabaseConnectionGuard.ts);
 *   4. socket check    -- any other client's socket to a denylisted live endpoint is refused.
 *
 * Allowed in a test runtime, and nothing else:
 *   (a) an explicitly dead target: loopback port 1, or a host under the reserved `.invalid` TLD;
 *   (b) an explicit opt-in: MIMER_TEST_DB_ALLOW=<database>, where <database> ends in `_test`
 *       and is exactly the database the connection targets.
 * The denylist below always wins, including over an opt-in.
 */

/** The explicit opt-in. Read from the process environment only, never from an env file. */
export const TEST_DATABASE_OPT_IN_ENV = 'MIMER_TEST_DB_ALLOW';

/** A database a test may opt into must look like a disposable test database. */
export const TEST_DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+_test$/;

export const TEST_DB_GUARD_LABEL = 'TEST-DB-GUARD (OD-K0-5)';

/**
 * Database names that are live, staging or production somewhere this repository deploys to.
 * Compared case-insensitively and exactly (never by prefix: `miljobeslut_test` is a test name).
 *   - miljobeslut          docker `miljobeslut-postgres` (0.0.0.0:5432), docker-compose.geodata.yml,
 *                          docker-compose.prod.yml, .env.example
 *   - miljobeslut_prod     docker-compose.prod.yml (`miljobeslut-db`), deploy/gcp (Cloud SQL)
 *   - miljobeslut_staging  docker-compose.staging.yml
 */
export const KNOWN_LIVE_DATABASE_NAMES: readonly string[] = [
  'miljobeslut',
  'miljobeslut_prod',
  'miljobeslut_staging',
];

/**
 * Host names of live/staging/production database servers, refused on ANY port.
 *   - miljobeslut-postgres          docker container (live `miljobeslut`), prod compose service
 *   - i2dbprefneg-postgres          docker container (5432/tcp, docker network only)
 *   - i2dbpref4f4a-postgres         docker container (5432/tcp, docker network only)
 *   - miljobeslut-db                docker-compose.prod.yml container; Cloud SQL instance name
 *   - miljobeslut-staging-postgres  docker-compose.staging.yml container
 *   - db                            compose service alias on the staging/platform networks
 *                                   (docker-compose.staging.yml, docker-compose.test.yml)
 */
export const KNOWN_LIVE_DATABASE_HOSTS: readonly string[] = [
  'miljobeslut-postgres',
  'i2dbprefneg-postgres',
  'i2dbpref4f4a-postgres',
  'miljobeslut-db',
  'miljobeslut-staging-postgres',
  'db',
];

/** Unix-socket hosts of managed production databases (deploy/gcp: `?host=/cloudsql/...`). */
export const KNOWN_LIVE_SOCKET_PATH_MARKERS: readonly string[] = ['/cloudsql/'];

/**
 * Ports that, on THIS workstation (any loopback or local interface address), belong to a live or
 * production database container:
 *   - 5432  docker `miljobeslut-postgres` publishes 0.0.0.0:5432 and [::]:5432 (live `miljobeslut`)
 *   - 5434  docker-compose.prod.yml `miljobeslut-db` publishes 5434 (`miljobeslut_prod`)
 * 5433 is deliberately absent: it is the documented disposable test database port
 * (.env.test.example); the staging compose that can also publish it is refused by name instead.
 */
export const WORKSTATION_LIVE_DATABASE_PORTS: readonly number[] = [5432, 5434];

const LOOPBACK_NAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::',
  '::1',
  'host.docker.internal',
  'gateway.docker.internal',
]);

const DEAD_PORT = 1;

export type DatabaseTarget = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
};

/** One flat shape (this repo compiles without strictNullChecks, so no discriminated union). */
export type TargetVerdict = {
  readonly allowed: boolean;
  /** Why it is allowed; null when refused. */
  readonly basis: 'dead-target' | 'explicit-opt-in' | null;
  /** `live-identity`: a known live name/host/socket; `workstation-port`: a live port here. */
  readonly denylist: 'live-identity' | 'workstation-port' | null;
  readonly reason: string;
};

function refused(denylist: TargetVerdict['denylist'], reason: string): TargetVerdict {
  return { allowed: false, basis: null, denylist, reason };
}

function admitted(basis: 'dead-target' | 'explicit-opt-in', reason: string): TargetVerdict {
  return { allowed: true, basis, denylist: null, reason };
}

/**
 * The explicit test-process marker, for a process that a test harness starts and that must not
 * get NODE_ENV=test (which would change product behaviour) -- e.g. the API server Playwright
 * starts. Recognized values: `1` and `true`. Such a process is a test runtime AND hermetic: it
 * reads no env file at all (neither `.env` nor `.env.local` nor any other), so the explicitly given
 * process environment -- with its controlled DATABASE_URL -- is its whole configuration.
 */
export const TEST_MODE_ENV = 'MIMER_TEST_MODE';

/** A process explicitly marked by MIMER_TEST_MODE: test runtime, and no env file is ever read. */
export function isHermeticTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  const marker = String(env[TEST_MODE_ENV] ?? '')
    .trim()
    .toLowerCase();
  return marker === '1' || marker === 'true';
}

/**
 * NODE_ENV=test, any Vitest worker (a test may set NODE_ENV=production to test a branch), or a
 * process explicitly marked by MIMER_TEST_MODE.
 */
export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || Boolean(env.VITEST) || isHermeticTestProcess(env);
}

function normalizeHost(host: string | undefined | null): string {
  const raw = String(host ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return 'localhost';
  return raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
}

function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_NAMES.has(host)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

let cachedLocalAddresses: Set<string> | null = null;

function localInterfaceAddresses(): Set<string> {
  if (cachedLocalAddresses) return cachedLocalAddresses;
  const addresses = new Set<string>();
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list ?? []) addresses.add(normalizeHost(entry.address));
    }
  } catch {
    // No interface list: loopback names still cover the live container.
  }
  try {
    addresses.add(normalizeHost(os.hostname()));
  } catch {
    // ignore
  }
  cachedLocalAddresses = addresses;
  return addresses;
}

/** Loopback, a wildcard, Docker's host alias, or one of this machine's own interface addresses. */
export function isWorkstationHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return isLoopbackHost(normalized) || localInterfaceAddresses().has(normalized);
}

function isSocketPath(host: string): boolean {
  return host.startsWith('/') || /^[a-z]:[\\/]/i.test(host) || host.startsWith('\\\\');
}

/**
 * Host/port-level denylist, shared by the connect check and the socket check. `port` null means
 * "not known" (a raw socket without a port): only the name/socket rules apply then.
 */
export function evaluateLiveEndpoint(
  hostInput: string | undefined | null,
  port: number | null,
): { denylist: 'live-identity' | 'workstation-port'; reason: string } | null {
  const host = normalizeHost(hostInput);

  if (KNOWN_LIVE_SOCKET_PATH_MARKERS.some((marker) => host.includes(marker))) {
    return { denylist: 'live-identity', reason: `socket path ${host} is a managed production database` };
  }
  if (KNOWN_LIVE_DATABASE_HOSTS.includes(host)) {
    return { denylist: 'live-identity', reason: `host ${host} is a known live/staging database server` };
  }
  if (
    port !== null &&
    !isSocketPath(host) &&
    WORKSTATION_LIVE_DATABASE_PORTS.includes(port) &&
    isWorkstationHost(host)
  ) {
    return {
      denylist: 'workstation-port',
      reason: `${host}:${port} is a live database port on this workstation`,
    };
  }
  return null;
}

/**
 * The whole decision. Order: denylist (name, host, socket, workstation port) -> dead target ->
 * explicit opt-in. Everything that is not (a) dead or (b) opted in is refused.
 */
export function evaluateTestDatabaseTarget(
  target: DatabaseTarget,
  env: NodeJS.ProcessEnv = process.env,
): TargetVerdict {
  const host = normalizeHost(target.host);
  const port = Number.isFinite(target.port) && target.port > 0 ? target.port : 5432;
  const database = String(target.database ?? '').trim();

  if (KNOWN_LIVE_DATABASE_NAMES.includes(database.toLowerCase())) {
    return refused(
      'live-identity',
      `database ${JSON.stringify(database)} is a known live/staging/production database`,
    );
  }
  const endpoint = evaluateLiveEndpoint(host, port);
  if (endpoint) return refused(endpoint.denylist, endpoint.reason);

  if ((isLoopbackHost(host) && port === DEAD_PORT) || host.endsWith('.invalid')) {
    return admitted('dead-target', `${host}:${port} is an explicitly dead target`);
  }

  const optIn = String(env[TEST_DATABASE_OPT_IN_ENV] ?? '').trim();
  if (!optIn) {
    return refused(
      null,
      `the target is not an explicitly dead target and ${TEST_DATABASE_OPT_IN_ENV} is not set`,
    );
  }
  if (!TEST_DATABASE_NAME_PATTERN.test(optIn)) {
    return refused(
      null,
      `${TEST_DATABASE_OPT_IN_ENV}=${JSON.stringify(optIn)} does not match the test pattern *_test`,
    );
  }
  if (optIn !== database) {
    return refused(
      null,
      `${TEST_DATABASE_OPT_IN_ENV}=${JSON.stringify(optIn)} does not name the targeted database ${JSON.stringify(database)}`,
    );
  }
  return admitted('explicit-opt-in', `${TEST_DATABASE_OPT_IN_ENV} names ${JSON.stringify(database)}`);
}

/** Never includes user or password. */
export function describeDatabaseTarget(target: DatabaseTarget): string {
  return `${normalizeHost(target.host)}:${target.port || 5432}/${target.database || '(no database)'}`;
}

export class TestDatabaseTargetRefusedError extends Error {
  readonly code = 'TEST_DB_GUARD_REFUSED';

  constructor(via: string, targetDescription: string, reason: string) {
    super(
      `${TEST_DB_GUARD_LABEL} refused ${via} -> ${targetDescription}: ${reason}. ` +
        `No connection was opened. A test runtime may only reach an explicitly dead target ` +
        `(127.0.0.1:1 or a *.invalid host) or an opted-in disposable database: set ` +
        `${TEST_DATABASE_OPT_IN_ENV}=<database> where <database> ends in _test, is exactly the ` +
        `targeted database, and is not on a live host/port (denylist: ${KNOWN_LIVE_DATABASE_NAMES.join(', ')}; ` +
        `${KNOWN_LIVE_DATABASE_HOSTS.join(', ')}; this workstation's ports ${WORKSTATION_LIVE_DATABASE_PORTS.join(', ')}).`,
    );
    this.name = 'TestDatabaseTargetRefusedError';
  }
}

export function assertTestDatabaseTargetAllowed(
  target: DatabaseTarget,
  via: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const verdict = evaluateTestDatabaseTarget(target, env);
  if (!verdict.allowed) {
    throw new TestDatabaseTargetRefusedError(via, describeDatabaseTarget(target), verdict.reason);
  }
}

const DATABASE_URL_VALUE = /^(postgres(ql)?|prisma(\+postgres)?):\/\//i;

/**
 * Parses a postgres connection URL the way pg does for the parts that matter here (host, port,
 * database, and a `?host=` socket override). Returns null for anything unparseable.
 */
export function parseDatabaseUrlTarget(url: string | undefined | null): DatabaseTarget | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const hostOverride = parsed.searchParams.get('host');
  const host = hostOverride || decodeURIComponent(parsed.hostname) || 'localhost';
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  return { host, port, database };
}

/** Prisma Accelerate / Prisma Postgres URLs point at a remote managed service, never a test DB. */
export function isRemoteManagedDatabaseUrl(url: string | undefined | null): boolean {
  return /^prisma(\+postgres)?:\/\//i.test(String(url ?? '').trim());
}

/**
 * Keys whose value is a database connection setting -- or the opt-in itself, which must come
 * from the process environment and never from a file. Never taken from an env file in tests.
 */
export function isDatabaseConnectionEnvKey(key: string, value?: string): boolean {
  const upper = key.toUpperCase();
  if (upper === TEST_DATABASE_OPT_IN_ENV) return true;
  if (upper.includes('DATABASE_URL') || upper === 'DIRECT_URL' || upper.endsWith('_DB_URL')) return true;
  if (/^(PG|POSTGRES)[A-Z0-9_]*$/.test(upper)) return true;
  if (/^DB_(HOST|PORT|NAME|USER|PASSWORD|URL)$/.test(upper)) return true;
  return value !== undefined && DATABASE_URL_VALUE.test(value.trim());
}

/** `.env.local`, `.env.development.local`, `.env.test.local`, ... -- never read in a test runtime. */
export function isLocalEnvFile(filePath: string): boolean {
  return /^\.env(\.[^\\/]+)?\.local$/i.test(path.basename(filePath));
}

/** Splits parsed env-file entries into what a test runtime may load and the DB keys it drops. */
export function splitDatabaseConnectionEntries(parsed: Record<string, string>): {
  kept: Record<string, string>;
  dropped: string[];
} {
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (isDatabaseConnectionEnvKey(key, value)) dropped.push(key);
    else kept[key] = value;
  }
  return { kept, dropped };
}

const notedEnvFileGuards = new Set<string>();

/** One stderr line per file and reason per process; names keys, never values. */
export function noteTestEnvFileGuard(filePath: string, message: string): void {
  const line = `[${TEST_DB_GUARD_LABEL}] ${filePath}: ${message}`;
  if (notedEnvFileGuards.has(line)) return;
  notedEnvFileGuards.add(line);
  process.stderr.write(`${line}\n`);
}

/**
 * Startup check: refuses a test run whose environment names a known live/staging database by
 * name, host or socket, or a remote managed database. A target that is merely not opted in (for
 * example CI's own service database) is left to the connect check, which refuses it if a test
 * actually tries to connect -- so suites that never connect keep running.
 */
export function assertNoKnownLiveDatabaseInEnv(env: NodeJS.ProcessEnv, via: string): void {
  const findings: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !DATABASE_URL_VALUE.test(value.trim())) continue;
    if (isRemoteManagedDatabaseUrl(value)) {
      findings.push(`${key} -> remote managed database (prisma://)`);
      continue;
    }
    const target = parseDatabaseUrlTarget(value);
    if (!target) continue;
    const verdict = evaluateTestDatabaseTarget(target, {});
    if (!verdict.allowed && verdict.denylist === 'live-identity') {
      findings.push(`${key} -> ${describeDatabaseTarget(target)} (${verdict.reason})`);
    }
  }
  if (env.PGHOST || env.PGDATABASE || env.PGPORT) {
    const target: DatabaseTarget = {
      host: env.PGHOST ?? 'localhost',
      port: Number(env.PGPORT) || 5432,
      database: env.PGDATABASE ?? env.PGUSER ?? '',
    };
    const verdict = evaluateTestDatabaseTarget(target, {});
    if (!verdict.allowed && verdict.denylist === 'live-identity') {
      findings.push(`PGHOST/PGPORT/PGDATABASE -> ${describeDatabaseTarget(target)} (${verdict.reason})`);
    }
  }
  if (findings.length > 0) {
    throw new TestDatabaseTargetRefusedError(
      via,
      'the test environment',
      `it names a known live/staging database: ${findings.join('; ')}. Unset it, or point it at ` +
        `postgresql://x:x@127.0.0.1:1/none`,
    );
  }
}
