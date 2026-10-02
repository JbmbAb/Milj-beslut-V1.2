// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as policy from '../../server/modules/test-db-guard/testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-2 finding 3: the denylist judges hosts by spelling. With the
 * opt-in, other spellings of this workstation's live port 5432 reached the socket layer
 * (`localhost.`, `kubernetes.docker.internal`, `?host=0:0:0:0:0:0:0:1`, `[::ffff:127.0.0.1]`,
 * `Mimer.`, `127.1`, ...), `?port=` overrode a checked port, and raw sockets needed no opt-in at
 * all. Now every host is judged in all its canonical spellings, every URL by every target it can
 * reach (pg, libpq, PG* fallbacks), and a host NAME on a denied port by what it resolves to.
 *
 * No case can reach a database, even with the guard removed: the policy cases are pure; the pg
 * cases run with net.Socket.prototype.connect replaced by a throwing spy; the raw-socket cases
 * run in a child process whose real connect was replaced by a recording sentinel BEFORE the guard
 * was installed over it, and every name is resolved by a fake lookup (no DNS).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INSTALLER_URL = pathToFileURL(
  path.join(REPO_ROOT, 'server/modules/test-db-guard/installTestDatabaseConnectionGuard.ts'),
).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const OPT_IN_DB = 'wtdg2_canon_test';
const OPT_IN = { MIMER_TEST_DB_ALLOW: OPT_IN_DB };
const HOSTNAME = os.hostname();
const savedEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

const target = (host: string, port: number, database = OPT_IN_DB) => ({ host, port, database });

describe('policy: every spelling of this workstation on a live port is refused, even opted in', () => {
  it.each([
    'localhost.',
    'LOCALHOST',
    'Localhost..',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '[0:0:0:0:0:0:0:1]',
    '[::ffff:127.0.0.1]',
    '::ffff:7f00:1',
    '127.1',
    '127.0.0.2',
    '2130706433',
    '0x7f000001',
    '0177.0.0.1',
    '0',
    '0.0.0.0',
    '::',
    '%6cocalhost',
    'foo.localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'host.docker.internal.',
    'kubernetes.docker.internal',
    'gateway.docker.internal',
    'docker.for.win.localhost',
    'host.containers.internal',
    `${HOSTNAME}.`,
    HOSTNAME.toUpperCase(),
    `${HOSTNAME}.mshome.net`,
    '/tmp',
    '/var/run/postgresql',
  ])('%s:5432', (host) => {
    const verdict = policy.evaluateTestDatabaseTarget(target(host, 5432), OPT_IN);
    expect(verdict).toMatchObject({ allowed: false, denylist: 'workstation-port' });
  });

  it.each([
    'MILJOBESLUT-POSTGRES',
    'miljobeslut-postgres.',
    'miljobeslut-postgres.miljobeslut_default',
    'DB',
  ])('live host %s is refused on any port', (host) => {
    const verdict = policy.evaluateTestDatabaseTarget(target(host, 6000), OPT_IN);
    expect(verdict).toMatchObject({ allowed: false, denylist: 'live-identity' });
  });

  it('a unix socket path names its port: /tmp/.s.PGSQL.5432 is the live port', () => {
    expect(policy.evaluateLiveEndpoint('/tmp/.s.PGSQL.5432', null)).toMatchObject({
      denylist: 'workstation-port',
    });
    expect(policy.evaluateLiveEndpoint('/tmp/.s.PGSQL.5433', null)).toBeNull();
  });

  it('controls: an opted-in *_test database on a free port, and explicitly dead targets, still pass', () => {
    expect(policy.evaluateTestDatabaseTarget(target('127.0.0.1', 5433), OPT_IN)).toMatchObject({
      allowed: true,
      basis: 'explicit-opt-in',
    });
    for (const host of ['localhost.', '[::ffff:127.0.0.1]', '127.1', 'wtdg2-anything.invalid.']) {
      expect(
        policy.evaluateTestDatabaseTarget(target(host, host.includes('invalid') ? 5432 : 1), {}),
      ).toMatchObject({
        allowed: true,
        basis: 'dead-target',
      });
    }
    expect(policy.evaluateLiveEndpoint('203.0.113.10', 5432)).toBeNull();
  });
});

describe('URLs: every target a URL can reach is judged (pg, libpq, PG* fallbacks)', () => {
  const url = (rest: string) => `postgresql://u:p@${rest}`;

  it.each<[string, string, NodeJS.ProcessEnv]>([
    ['?port= overriding a free port', url(`127.0.0.1:5433/${OPT_IN_DB}?port=5432`), {}],
    ['?host= in full IPv6 form', url(`wtdg2.invalid:5432/${OPT_IN_DB}?host=0:0:0:0:0:0:0:1`), {}],
    [
      '?host= list with a loopback entry',
      url(`wtdg2.invalid:5432/${OPT_IN_DB}?host=wtdg2-a.invalid,localhost.`),
      {},
    ],
    ['?hostaddr= (libpq connects there)', url(`wtdg2.invalid:5432/${OPT_IN_DB}?hostaddr=127.0.0.1`), {}],
    ['?dbname= naming the live database (libpq)', url(`127.0.0.1:5433/${OPT_IN_DB}?dbname=miljobeslut`), {}],
    ['?service= (unverifiable)', url(`127.0.0.1:5433/${OPT_IN_DB}?service=wtdg2`), {}],
    ['PGSERVICEFILE set (unverifiable)', url(`127.0.0.1:5433/${OPT_IN_DB}`), { PGSERVICEFILE: 'wtdg2.conf' }],
    ['no port in the URL, PGPORT=5432', url(`127.0.0.1/${OPT_IN_DB}`), { PGPORT: '5432' }],
    [
      'no host in the URL, PGHOST a Docker alias',
      url(`/${OPT_IN_DB}?port=5432`),
      { PGHOST: 'kubernetes.docker.internal' },
    ],
    ['a socket: URL on the live port', `socket:///var/run/postgresql?db=${OPT_IN_DB}`, {}],
    ['the pg "/socket database" form', `/var/run/postgresql ${OPT_IN_DB}`, {}],
    ['a percent-encoded host', url(`%6cocalhost:5432/${OPT_IN_DB}`), {}],
    ['a bracketed IPv4-mapped host', url(`[::ffff:127.0.0.1]:5432/${OPT_IN_DB}`), {}],
  ])('refuses %s', (_label, databaseUrl, env) => {
    const verdict = policy.evaluateDatabaseUrl(databaseUrl, { ...OPT_IN, ...env });
    expect(verdict.allowed).toBe(false);
  });

  it('admits a plain opted-in URL on a free port, and PGPORT=5433 for a URL without a port', () => {
    expect(policy.evaluateDatabaseUrl(url(`127.0.0.1:5433/${OPT_IN_DB}`), OPT_IN)).toMatchObject({
      allowed: true,
      basis: 'explicit-opt-in',
    });
    expect(
      policy.evaluateDatabaseUrl(url(`127.0.0.1/${OPT_IN_DB}`), { ...OPT_IN, PGPORT: '5433' }),
    ).toMatchObject({
      allowed: true,
    });
    expect(policy.evaluateDatabaseUrl('postgresql://x:x@127.0.0.1:1/none', {})).toMatchObject({
      allowed: true,
      basis: 'dead-target',
    });
  });

  it('the startup check sees live identities behind overrides and PG* variables', () => {
    for (const env of [
      { DATABASE_URL: url(`wtdg2.invalid:1/${OPT_IN_DB}?dbname=miljobeslut`) },
      { DATABASE_URL: url(`wtdg2.invalid:1/${OPT_IN_DB}?host=MILJOBESLUT-POSTGRES.`) },
      { PGHOST: 'miljobeslut-postgres.', PGDATABASE: 'x' },
      { PGSERVICE: 'wtdg2' },
    ] as NodeJS.ProcessEnv[]) {
      expect(() => policy.assertNoKnownLiveDatabaseInEnv(env, 'wtdg2')).toThrow(/TEST-DB-GUARD/);
    }
    expect(() =>
      policy.assertNoKnownLiveDatabaseInEnv({ DATABASE_URL: url('localhost:5432/riskguard_test') }, 'wtdg2'),
    ).not.toThrow();
  });
});

describe('pg: an opted-in client on another spelling of the live port is refused before any socket', () => {
  it.each([
    `postgresql://u:p@localhost.:5432/${OPT_IN_DB}`,
    `postgresql://u:p@127.1:5432/${OPT_IN_DB}`,
    `postgresql://u:p@kubernetes.docker.internal:5432/${OPT_IN_DB}`,
    `postgresql://u:p@wtdg2.invalid:5433/${OPT_IN_DB}?host=0:0:0:0:0:0:0:1&port=5432`,
    `postgresql://u:p@${HOSTNAME}.:5432/${OPT_IN_DB}`,
  ])('%s', async (connectionString) => {
    process.env.MIMER_TEST_DB_ALLOW = OPT_IN_DB;
    const sockets = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('WTDG2_SOCKET_CONNECT_REACHED');
    });
    const client = new pg.Client({ connectionString });
    const error = await client.connect().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(String(error?.message)).toMatch(/TEST-DB-GUARD.*pg\.Client\.connect/);
    expect(sockets).not.toHaveBeenCalled();
  });
});

type SocketOutcome = { label: string; outcome: string; detail: string };

/**
 * Runs raw net/tls connects in a child whose REAL net.Socket.prototype.connect was replaced by a
 * recording sentinel before the guard was installed over it: a refused connect never reaches the
 * sentinel; an allowed one does, and the sentinel runs the lookup the socket would use.
 */
function rawSocketOutcomesInChild(): SocketOutcome[] {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg2-raw-socket-'));
  const childCode = `
import net from 'node:net';
import tls from 'node:tls';
const pending = [];
let current = null;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const opts = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : undefined };
  const label = current;
  if (typeof opts.lookup === 'function' && opts.host) {
    pending.push(new Promise((resolve) => {
      opts.lookup(opts.host, { all: true }, (err, addresses) => {
        resolve(err ? { label, outcome: 'refused-after-lookup', detail: String(err.message).slice(0, 160) }
                    : { label, outcome: 'reached-after-lookup', detail: JSON.stringify(addresses) });
      });
    }));
  } else {
    pending.push(Promise.resolve({ label, outcome: 'reached', detail: String(opts.host ?? opts.path) + ':' + String(opts.port) }));
  }
  return this;
};
const { installTestDatabaseConnectionGuard } = await import(${JSON.stringify(INSTALLER_URL)});
installTestDatabaseConnectionGuard();
const resolvesTo = (address, family) => (host, options, callback) =>
  options && options.all ? callback(null, [{ address, family }]) : callback(null, address, family);
const cases = [
  ['net.Socket#connect(port, host) localhost.:5432', () => new net.Socket().connect(5432, 'localhost.')],
  ['net.connect [::ffff:127.0.0.1]:5432', () => net.connect({ host: '[::ffff:127.0.0.1]', port: 5432 })],
  ['net.connect 0:0:0:0:0:0:0:1:5432', () => net.connect({ host: '0:0:0:0:0:0:0:1', port: 5432 })],
  ['net.connect 127.1:5432', () => net.connect({ host: '127.1', port: 5432 })],
  ['net.connect kubernetes.docker.internal:5432', () => net.connect({ host: 'kubernetes.docker.internal', port: 5432 })],
  ['net.connect own hostname + .mshome.net:5432', () => net.connect({ host: ${JSON.stringify(HOSTNAME)} + '.mshome.net', port: 5432 })],
  ['net.connect unix socket /tmp/.s.PGSQL.5432', () => net.connect({ path: '/tmp/.s.PGSQL.5432' })],
  ['tls.connect [::ffff:127.0.0.1]:5432', () => tls.connect({ host: '[::ffff:127.0.0.1]', port: 5432 })],
  ['a name resolving to 127.0.0.1 on 5432 (own lookup)', () => net.connect({ host: 'wtdg2-alias', port: 5432, lookup: resolvesTo('127.0.0.1', 4) })],
  ['a name resolving to ::ffff:127.0.0.1 on 5432 (own lookup)', () => net.connect({ host: 'wtdg2-alias', port: 5432, lookup: resolvesTo('::ffff:127.0.0.1', 6) })],
  ['control: a name resolving to a remote address on 5432', () => net.connect({ host: 'wtdg2-remote', port: 5432, lookup: resolvesTo('203.0.113.10', 4) })],
  ['control: 127.0.0.1 on a free port', () => net.connect({ host: '127.0.0.1', port: 5433 })],
];
const results = [];
for (const [label, run] of cases) {
  current = label;
  try { const s = run(); if (s && s.on) s.on('error', () => undefined); }
  catch (e) { results.push({ label, outcome: 'refused', detail: String(e && e.message).slice(0, 160) }); }
}
results.push(...(await Promise.all(pending)));
process.stdout.write('WTDG2_RESULT ' + JSON.stringify(results) + String.fromCharCode(10));
process.exit(0);
`;
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // The opt-in is set on purpose: raw sockets to a live port are refused whatever the opt-in.
  Object.assign(env, { MIMER_TEST_MODE: '1', MIMER_TEST_DB_ALLOW: OPT_IN_DB });
  try {
    const result = spawnSync(
      process.execPath,
      ['--import', TSX_LOADER_URL, '--input-type=module', '-e', childCode],
      {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 90_000,
      },
    );
    const line = String(result.stdout ?? '')
      .split(/\r?\n/)
      .find((l) => l.startsWith('WTDG2_RESULT '));
    if (!line) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
    return JSON.parse(line.slice('WTDG2_RESULT '.length)) as SocketOutcome[];
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe('raw net/tls sockets: a denied port on this workstation is refused in every spelling, opt-in or not', () => {
  it('refuses every spelling and every name that resolves here; lets the controls through', () => {
    const outcomes = Object.fromEntries(rawSocketOutcomesInChild().map((o) => [o.label, o.outcome]));
    expect(outcomes).toEqual({
      'net.Socket#connect(port, host) localhost.:5432': 'refused',
      'net.connect [::ffff:127.0.0.1]:5432': 'refused',
      'net.connect 0:0:0:0:0:0:0:1:5432': 'refused',
      'net.connect 127.1:5432': 'refused',
      'net.connect kubernetes.docker.internal:5432': 'refused',
      'net.connect own hostname + .mshome.net:5432': 'refused',
      'net.connect unix socket /tmp/.s.PGSQL.5432': 'refused',
      'tls.connect [::ffff:127.0.0.1]:5432': 'refused',
      'a name resolving to 127.0.0.1 on 5432 (own lookup)': 'refused-after-lookup',
      'a name resolving to ::ffff:127.0.0.1 on 5432 (own lookup)': 'refused-after-lookup',
      'control: a name resolving to a remote address on 5432': 'reached-after-lookup',
      'control: 127.0.0.1 on a free port': 'reached',
    });
  });
});
