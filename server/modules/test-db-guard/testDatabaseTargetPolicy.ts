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
 *   4. socket check    -- any other client's socket (net and tls) to a denylisted live endpoint is
 *                         refused, whatever the opt-in -- a host name on a live port also by
 *                         what it resolves to.
 *
 * Every host is judged in all its canonical spellings (canonicalHostForms) and every database URL
 * by every target it can reach for pg, libpq and the PG* fallbacks (parseDatabaseUrlTargets).
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

/**
 * Names that are this workstation itself (loopback, wildcard). Compared after canonicalization
 * (see canonicalHostForms): lower case, no trailing dot, no brackets, IPv6 compressed, IPv4-mapped
 * IPv6 unmapped, short and numeric IPv4 forms (127.1, 2130706433, 0x7f000001, 0) expanded.
 */
const LOOPBACK_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'localhost6',
  'localhost6.localdomain6',
  'ip6-localhost',
  'ip6-loopback',
  '0.0.0.0',
  '::',
  '::1',
]);

/** Docker / container-runtime names that reach this workstation (hosts file, Docker Desktop). */
const DOCKER_HOST_ALIASES = new Set([
  'host.docker.internal',
  'gateway.docker.internal',
  'kubernetes.docker.internal',
  'docker.for.win.localhost',
  'docker.for.mac.localhost',
  'docker.for.win.host.internal',
  'docker.for.mac.host.internal',
  'host.containers.internal',
  'host.lima.internal',
  'host.minikube.internal',
  'host-gateway',
]);

/** Any name under these is treated as this workstation (RFC 6761 `.localhost`, Docker's zones). */
const WORKSTATION_NAME_SUFFIXES = ['.localhost', '.docker.internal', '.containers.internal'];

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
 *
 * Third value, `vitest-worker:<pid>`: set by the Vitest setup file (tests/setup/testDatabaseGuard.ts)
 * in every worker, so that every process a test starts inherits it -- also when the test strips
 * VITEST and NODE_ENV to run a script "as an operator would". The worker itself (same pid) keeps
 * the Vitest rule (no `*.local`, no database keys from env files; fixtures still load); every
 * other process carrying it -- a child, a grandchild -- is a hermetic test process.
 */
export const TEST_MODE_ENV = 'MIMER_TEST_MODE';

const VITEST_WORKER_TEST_MODE = /^vitest-worker:(\d+)$/;

/** The MIMER_TEST_MODE value a Vitest worker hands down to every process its tests start. */
export function vitestWorkerTestModeMarker(pid: number = process.pid): string {
  return `vitest-worker:${pid}`;
}

function testModeMarkerOf(env: NodeJS.ProcessEnv): string {
  return String(env[TEST_MODE_ENV] ?? '')
    .trim()
    .toLowerCase();
}

/**
 * A process marked by MIMER_TEST_MODE (other than the Vitest worker that set the inherited
 * marker): test runtime, and no env file is ever read.
 */
export function isHermeticTestProcess(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
): boolean {
  const marker = testModeMarkerOf(env);
  if (marker === '1' || marker === 'true') return true;
  const worker = VITEST_WORKER_TEST_MODE.exec(marker);
  return worker !== null && Number(worker[1]) !== pid;
}

/**
 * NODE_ENV=test, any Vitest worker (a test may set NODE_ENV=production to test a branch), or a
 * process marked by MIMER_TEST_MODE.
 */
export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const marker = testModeMarkerOf(env);
  return (
    env.NODE_ENV === 'test' ||
    Boolean(env.VITEST) ||
    marker === '1' ||
    marker === 'true' ||
    VITEST_WORKER_TEST_MODE.test(marker)
  );
}

function isSocketPathForm(host: string): boolean {
  return host.startsWith('/') || /^[a-z]:[\\/]/i.test(host) || host.startsWith('\\\\');
}

/** WHATWG's host parser canonicalizes IPv4 (127.1, 2130706433, 0x7f000001, 0177.0.0.1, 0) and IPv6. */
function whatwgHostForm(host: string): string | null {
  try {
    const hostname = new URL(`http://${host.includes(':') ? `[${host}]` : host}/`).hostname;
    const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return bare.replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

/** `::ffff:7f00:1` (IPv4-mapped) and `::7f00:1` (IPv4-compatible) -> `127.0.0.1`. */
function ipv4FromEmbeddingIpv6(host: string): string | null {
  const match = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!match) return null;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * Every canonical spelling of a host; the guard applies its rules to ALL of them and refuses a
 * host if any spelling is refused. Lower case; URL-decoded (once more than the client does); no
 * brackets, IPv6 zone id or trailing dots; the WHATWG canonical IP form; an IPv4 embedded in IPv6
 * unmapped. `localhost.`, `[::ffff:127.0.0.1]`, `0:0:0:0:0:0:0:1`, `127.1`, `0x7f000001`,
 * `%6cocalhost` and `Mimer.` all reach their canonical form here.
 */
export function canonicalHostForms(input: string | undefined | null): string[] {
  const raw = String(input ?? '').trim();
  if (!raw) return ['localhost'];
  const spellings = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) spellings.push(decoded);
  } catch {
    // not URL-encoded
  }
  const forms = new Set<string>();
  for (const spelling of spellings) {
    let host = spelling.trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if (isSocketPathForm(host)) {
      forms.add(host);
      continue;
    }
    if (host.includes(':')) host = host.replace(/%.*$/, '');
    host = host.replace(/\.+$/, '');
    if (!host) continue;
    forms.add(host);
    const canonical = whatwgHostForm(host);
    if (canonical) {
      forms.add(canonical);
      const ipv4 = ipv4FromEmbeddingIpv6(canonical);
      if (ipv4) forms.add(ipv4);
    }
  }
  return forms.size > 0 ? [...forms] : ['localhost'];
}

let cachedOwnIdentity: { addresses: Set<string>; hostname: string } | null = null;

function ownIdentity(): { addresses: Set<string>; hostname: string } {
  if (cachedOwnIdentity) return cachedOwnIdentity;
  const addresses = new Set<string>();
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list ?? [])
        for (const form of canonicalHostForms(entry.address)) addresses.add(form);
    }
  } catch {
    // No interface list: loopback names still cover the live container.
  }
  let hostname = '';
  try {
    hostname = os.hostname().trim().toLowerCase().replace(/\.+$/, '');
  } catch {
    // ignore
  }
  cachedOwnIdentity = { addresses, hostname };
  return cachedOwnIdentity;
}

/**
 * One canonical form that is this workstation: loopback (127.0.0.0/8, ::1, localhost variants),
 * wildcard (0.0.0.0/8, ::), a Docker/container host alias, one of this machine's own interface
 * addresses, its hostname or any name under it (`mimer.mshome.net`), or a unix socket path.
 */
function isWorkstationForm(host: string): boolean {
  if (isSocketPathForm(host)) return true;
  if (LOOPBACK_NAMES.has(host) || DOCKER_HOST_ALIASES.has(host)) return true;
  if (WORKSTATION_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (/^(127|0)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const own = ownIdentity();
  if (own.addresses.has(host)) return true;
  return own.hostname !== '' && (host === own.hostname || host.startsWith(`${own.hostname}.`));
}

/** This workstation, in any canonical spelling (see canonicalHostForms and isWorkstationForm). */
export function isWorkstationHost(host: string | undefined | null): boolean {
  return canonicalHostForms(host).some(isWorkstationForm);
}

function isKnownLiveHostForm(host: string): boolean {
  if (KNOWN_LIVE_DATABASE_HOSTS.includes(host)) return true;
  // `miljobeslut-postgres.<network>`: a container name qualified by a Docker network or domain.
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(':');
  return !isIpLiteral && KNOWN_LIVE_DATABASE_HOSTS.includes(host.split('.')[0]);
}

/** A unix socket path names its port: `/tmp/.s.PGSQL.5432` -> 5432. */
function socketPathPort(forms: readonly string[]): number | null {
  for (const form of forms) {
    const match = /\.s\.pgsql\.(\d+)$/.exec(form);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Ports refused on every address of this workstation, whatever the opt-in. */
export function deniedWorkstationDatabasePorts(): readonly number[] {
  return WORKSTATION_LIVE_DATABASE_PORTS;
}

/**
 * Host/port-level denylist, shared by the connect check and the socket check, applied to every
 * canonical form of the host. `port` null means "not known" (a raw socket without a port): only
 * the name/socket rules apply then, and the port a unix socket path names.
 */
export function evaluateLiveEndpoint(
  hostInput: string | undefined | null,
  port: number | null,
): { denylist: 'live-identity' | 'workstation-port'; reason: string } | null {
  const forms = canonicalHostForms(hostInput);
  for (const host of forms) {
    if (KNOWN_LIVE_SOCKET_PATH_MARKERS.some((marker) => host.includes(marker))) {
      return { denylist: 'live-identity', reason: `socket path ${host} is a managed production database` };
    }
    if (isKnownLiveHostForm(host)) {
      return { denylist: 'live-identity', reason: `host ${host} is a known live/staging database server` };
    }
  }
  const effectivePort = port ?? socketPathPort(forms);
  if (
    effectivePort !== null &&
    deniedWorkstationDatabasePorts().includes(effectivePort) &&
    forms.some(isWorkstationForm)
  ) {
    return {
      denylist: 'workstation-port',
      reason: `${forms.join(' = ')}:${effectivePort} is a live database port on this workstation`,
    };
  }
  return null;
}

/** libpq accepts a comma-separated host list; every listed host is a target. */
function hostList(host: string | undefined | null): string[] {
  const hosts = String(host ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : ['localhost'];
}

/** Port 1 on this workstation (nothing listens there), or a host under the reserved `.invalid`. */
function isDeadHost(host: string, port: number): boolean {
  const forms = canonicalHostForms(host);
  if (forms.every((form) => form === 'invalid' || form.endsWith('.invalid'))) return true;
  return port === DEAD_PORT && forms.some(isWorkstationForm);
}

/**
 * The whole decision. Order: denylist (name, host, socket, workstation port; every canonical
 * spelling) -> dead target -> explicit opt-in. Everything that is not (a) dead or (b) opted in is
 * refused.
 */
export function evaluateTestDatabaseTarget(
  target: DatabaseTarget,
  env: NodeJS.ProcessEnv = process.env,
): TargetVerdict {
  const hosts = hostList(target.host);
  const port = Number.isFinite(target.port) && target.port > 0 ? target.port : 5432;
  const database = String(target.database ?? '').trim();

  if (KNOWN_LIVE_DATABASE_NAMES.includes(database.toLowerCase())) {
    return refused(
      'live-identity',
      `database ${JSON.stringify(database)} is a known live/staging/production database`,
    );
  }
  for (const host of hosts) {
    const endpoint = evaluateLiveEndpoint(host, port);
    if (endpoint) return refused(endpoint.denylist, endpoint.reason);
  }

  if (hosts.every((host) => isDeadHost(host, port))) {
    return admitted('dead-target', `${hosts.join(',')}:${port} is an explicitly dead target`);
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
  const host = String(target.host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  return `${host || 'localhost'}:${target.port || 5432}/${target.database || '(no database)'}`;
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
        `${KNOWN_LIVE_DATABASE_HOSTS.join(', ')}; this workstation's ports ${deniedWorkstationDatabasePorts().join(', ')}).`,
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
 * Parses a postgres connection URL the way pg (pg-connection-string) does: `?host=` and `?port=`
 * override the authority, the database is the path. The single target pg connects to; the guard
 * itself evaluates every target a URL can reach (parseDatabaseUrlTargets). Null if unparseable.
 */
export function parseDatabaseUrlTarget(url: string | undefined | null): DatabaseTarget | null {
  const parsed = parseConnectionUrl(url);
  if (!parsed) return null;
  const { url: u, dummyHost } = parsed;
  const host = u.searchParams.get('host') || (dummyHost ? '' : safeDecode(u.hostname)) || 'localhost';
  const portText = u.searchParams.get('port') || u.port;
  const port = portText ? Number(portText) : 5432;
  const database = safeDecode(u.pathname.replace(/^\//, ''));
  return { host, port, database };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** pg-connection-string's own fallback: `user@/db?host=/socket` has no authority host. */
function parseConnectionUrl(url: string | undefined | null): { url: URL; dummyHost: boolean } | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    return { url: new URL(raw), dummyHost: false };
  } catch {
    try {
      return { url: new URL(raw.replace('@/', '@___DUMMY___/')), dummyHost: true };
    } catch {
      return null;
    }
  }
}

function listValues(values: ReadonlyArray<string | undefined | null>, split: boolean): string[] {
  const out = new Set<string>();
  for (const value of values) {
    for (const part of split ? String(value ?? '').split(',') : [String(value ?? '')]) {
      const trimmed = part.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}

export type DatabaseUrlTargets = {
  readonly targets: readonly DatabaseTarget[];
  /** Why the URL cannot be verified at all (a libpq service definition), or null. */
  readonly unverifiable: string | null;
};

/**
 * Every target a postgres URL can reach, for every client in the chain: pg (`?host`, `?port`
 * override the authority), libpq -- psql, ogr2ogr, the Prisma CLI -- (`?hostaddr`, `?dbname`,
 * comma-separated host lists, `?service`), the `socket:` and `/socket database` forms, and the
 * fallbacks pg and libpq take from the environment when the URL is silent (PGHOST, PGHOSTADDR,
 * PGPORT, PGDATABASE, the user). Hosts x ports x databases is returned; the guard admits the URL
 * only if it admits every one. A service (`?service`, PGSERVICE, PGSERVICEFILE) is unverifiable.
 * `?options` is parsed by libpq as server startup options: it cannot change host, port or database.
 */
export function parseDatabaseUrlTargets(
  url: string | undefined | null,
  env: NodeJS.ProcessEnv = {},
): DatabaseUrlTargets | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  let hosts: string[];
  let ports: string[];
  let databases: string[];
  let services: string[];
  if (raw.startsWith('/')) {
    const [socketDirectory, database] = raw.split(' ');
    hosts = [socketDirectory];
    ports = [];
    databases = listValues([database], false);
    services = [];
  } else {
    const parsed = parseConnectionUrl(raw);
    if (!parsed) return null;
    const { url: u, dummyHost } = parsed;
    const q = u.searchParams;
    const isSocketUrl = u.protocol === 'socket:';
    const authorityHost = isSocketUrl ? safeDecode(u.pathname) : dummyHost ? '' : safeDecode(u.hostname);
    hosts = listValues([authorityHost, ...q.getAll('host'), ...q.getAll('hostaddr')], true);
    ports = listValues([u.port, ...q.getAll('port')], true);
    const dbPath = isSocketUrl ? '' : u.pathname.replace(/^\//, '');
    databases = listValues(
      [
        dbPath,
        safeDecode(dbPath),
        ...q.getAll('dbname'),
        ...q.getAll('database'),
        ...(isSocketUrl ? q.getAll('db') : []),
      ],
      false,
    );
    if (databases.length === 0) databases = listValues([safeDecode(u.username), ...q.getAll('user')], false);
    services = listValues(q.getAll('service'), true);
  }
  if (hosts.length === 0) hosts = listValues([env.PGHOST, env.PGHOSTADDR], true);
  if (hosts.length === 0) hosts = ['localhost'];
  if (ports.length === 0) ports = listValues([env.PGPORT], true);
  if (ports.length === 0) ports = ['5432'];
  databases = listValues(
    [...databases, env.PGDATABASE, ...(databases.length === 0 ? [env.PGUSER] : [])],
    false,
  );
  if (databases.length === 0) databases = [''];
  services = listValues([...services, env.PGSERVICE], true);
  const unverifiable =
    services.length > 0
      ? `it names the libpq service ${services.join(', ')}`
      : String(env.PGSERVICEFILE ?? '').trim()
        ? 'PGSERVICEFILE is set'
        : null;

  const targets: DatabaseTarget[] = [];
  for (const host of hosts) {
    for (const port of ports) {
      for (const database of databases) targets.push({ host, port: Number(port), database });
    }
  }
  return { targets, unverifiable };
}

export type DatabaseUrlVerdict = TargetVerdict & {
  /** The (first) refused target, or the first target; never user or password. */
  readonly target: string;
};

/** Admits a URL only if every target it can reach is admitted (dead, or opted in). */
export function evaluateDatabaseUrl(
  url: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseUrlVerdict {
  if (isRemoteManagedDatabaseUrl(url)) {
    return {
      ...refused('live-identity', 'a remote managed database is never a test target'),
      target: 'prisma://',
    };
  }
  const parsed = parseDatabaseUrlTargets(url, env);
  if (!parsed || parsed.targets.length === 0) {
    return { ...refused(null, 'the database URL cannot be parsed'), target: '(unparseable URL)' };
  }
  const first = describeDatabaseTarget(parsed.targets[0]);
  if (parsed.unverifiable) {
    return {
      ...refused(null, `${parsed.unverifiable}; the guard cannot see which database that is`),
      target: first,
    };
  }
  let basis: 'dead-target' | 'explicit-opt-in' = 'dead-target';
  let reason = '';
  for (const target of parsed.targets) {
    const verdict = evaluateTestDatabaseTarget(target, env);
    if (!verdict.allowed) return { ...verdict, target: describeDatabaseTarget(target) };
    if (verdict.basis === 'explicit-opt-in') basis = 'explicit-opt-in';
    reason = verdict.reason;
  }
  return { ...admitted(basis, reason), target: first };
}

export function assertDatabaseUrlAllowed(
  url: string | undefined | null,
  via: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const verdict = evaluateDatabaseUrl(url, env);
  if (!verdict.allowed) throw new TestDatabaseTargetRefusedError(via, verdict.target, verdict.reason);
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
  const liveIdentityOf = (url: string): string | null => {
    const parsed = parseDatabaseUrlTargets(url, env);
    if (!parsed) return null;
    if (parsed.unverifiable) return `${parsed.unverifiable} (unverifiable)`;
    for (const target of parsed.targets) {
      const verdict = evaluateTestDatabaseTarget(target, {});
      if (!verdict.allowed && verdict.denylist === 'live-identity') {
        return `${describeDatabaseTarget(target)} (${verdict.reason})`;
      }
    }
    return null;
  };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !DATABASE_URL_VALUE.test(value.trim())) continue;
    if (isRemoteManagedDatabaseUrl(value)) {
      findings.push(`${key} -> remote managed database (prisma://)`);
      continue;
    }
    const live = liveIdentityOf(value);
    if (live) findings.push(`${key} -> ${live}`);
  }
  if (env.PGHOST || env.PGHOSTADDR || env.PGDATABASE || env.PGPORT || env.PGSERVICE || env.PGSERVICEFILE) {
    // What pg and libpq connect to from the PG* variables alone.
    const live = liveIdentityOf('postgresql://');
    if (live) findings.push(`PGHOST/PGHOSTADDR/PGPORT/PGDATABASE/PGSERVICE -> ${live}`);
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
