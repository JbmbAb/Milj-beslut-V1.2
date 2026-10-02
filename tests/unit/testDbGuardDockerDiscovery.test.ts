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

import * as localE2e from '../../server/modules/test-db-guard/localE2eServerPolicy';
import * as policy from '../../server/modules/test-db-guard/testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-2 finding 4: the running staging database
 * `miljobeslut-lu-proof-db` (127.0.0.1:55432, `miljobeslut_staging`) was in neither the denylist
 * nor the inventory; an opted-in *_test database on 55432 and a raw socket to it were let through.
 * Now it is on the static list, and every host port a running non-test Docker container publishes
 * is denied as well (best effort; without Docker the static list applies).
 *
 * `docker ps` is only ever faked here (canned output, a failing runner), except where this
 * worker's own setup already ran the real discovery, whose result is only read. The one real
 * socket goes to this test's own TCP listener (no database) after its port was registered as live.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const DISCOVERY_URL = pathToFileURL(
  path.join(REPO_ROOT, 'server/modules/test-db-guard/dockerPublishedDatabaseEndpoints.ts'),
).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const OPT_IN_DB = 'wtdg2_docker_test';
const OPT_IN = { MIMER_TEST_DB_ALLOW: OPT_IN_DB };
const savedEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

/** The shape `docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Image}}'` prints (names/ports/images only). */
const DOCKER_PS_SAMPLE = [
  'miljobeslut-lu-proof-db\t127.0.0.1:55432->5432/tcp\tghcr.io/jbmbab/milj-beslut-postgres-test:16',
  'i2dbprefneg-postgres\t5432/tcp\tghcr.io/jbmbab/milj-beslut-postgres-test:16',
  'miljobeslut-postgres\t0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp\tmiljobeslut-platform-recovery-db:latest',
  'wtdg2-unknown-new-db\t127.0.0.1:61234->5432/tcp\tpostgres:17',
  'wtdg2-range-app\t0.0.0.0:41000-41002->8000-8002/tcp\twtdg2/app',
  'wtdg2-pg-test\t127.0.0.1:5440->5432/tcp\tpostgres:16',
  'naughty_matsumoto\t\te8cbb5c3ae86',
].join('\n');

const okRun = (stdout: string) => () => ({ status: 0, stdout, stderr: '' });

/** Loaded per test so that each case stands on its own (also when the module is absent: RED). */
const loadDiscovery = (): Promise<
  typeof import('../../server/modules/test-db-guard/dockerPublishedDatabaseEndpoints')
> => import(/* @vite-ignore */ DISCOVERY_URL);

describe('static denylist: the LU proof staging database', () => {
  it('port 55432 on this workstation is refused, even for an opted-in *_test database', () => {
    expect(
      policy.evaluateTestDatabaseTarget({ host: '127.0.0.1', port: 55432, database: OPT_IN_DB }, OPT_IN),
    ).toMatchObject({ allowed: false, denylist: 'workstation-port' });
    expect(policy.evaluateLiveEndpoint('localhost', 55432)).not.toBeNull();
  });

  it('its container and service names are refused on any port', () => {
    for (const host of ['miljobeslut-lu-proof-db', 'lu-proof-db']) {
      expect(
        policy.evaluateTestDatabaseTarget({ host, port: 5433, database: OPT_IN_DB }, OPT_IN),
      ).toMatchObject({
        allowed: false,
        denylist: 'live-identity',
      });
    }
  });

  it('the proof stack app port 8877 is never a local E2E port', () => {
    expect(() =>
      localE2e.resolveLocalE2eServerPlan({
        PLAYWRIGHT_DATABASE_URL: `postgresql://u:p@127.0.0.1:5433/${OPT_IN_DB}`,
        ...OPT_IN,
        PLAYWRIGHT_LOCAL_API_PORT: '8877',
      }),
    ).toThrow(/port 8877/);
  });
});

describe('docker ps: parsing and classification (faked output)', () => {
  it('reads published host ports, including ranges and IPv6 binds, and skips unpublished ones', async () => {
    const discovery = await loadDiscovery();
    expect(discovery.parsePublishedHostPorts('0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp')).toEqual([5432]);
    expect(discovery.parsePublishedHostPorts('127.0.0.1:41000-41002->8000-8002/tcp')).toEqual([
      41000, 41001, 41002,
    ]);
    expect(discovery.parsePublishedHostPorts('5432/tcp')).toEqual([]);
  });

  it('denies every published port of a non-test container (the staging proof DB and an unknown new one)', async () => {
    const discovery = await loadDiscovery();
    const result = discovery.discoverDockerDatabaseEndpoints(okRun(DOCKER_PS_SAMPLE));
    expect(result.status).toBe('ok');
    expect(result.deniedPorts).toEqual([5432, 41000, 41001, 41002, 55432, 61234]);
    expect(result.deniedNames).toEqual(
      expect.arrayContaining(['miljobeslut-lu-proof-db', 'i2dbprefneg-postgres', 'wtdg2-unknown-new-db']),
    );
    expect(result.deniedNames).not.toContain('wtdg2-pg-test');
  });

  it('a test-named container is a disposable test DB only if nothing names it live/staging/proof', async () => {
    const discovery = await loadDiscovery();
    expect(discovery.isDisposableTestContainerName('wtdg2-pg-test')).toBe(true);
    expect(discovery.isDisposableTestContainerName('miljobeslut-postgres-test')).toBe(true);
    expect(discovery.isDisposableTestContainerName('miljobeslut-lu-proof-db')).toBe(false);
    expect(discovery.isDisposableTestContainerName('staging-test-db')).toBe(false);
    expect(discovery.isDisposableTestContainerName('latest-db')).toBe(false);
  });

  it('without docker the discovery is unavailable and says why; the static list still applies', async () => {
    const discovery = await loadDiscovery();
    const missing = discovery.discoverDockerDatabaseEndpoints(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
    }));
    expect(missing).toMatchObject({ status: 'unavailable', deniedPorts: [] });
    expect(missing.detail).toMatch(/ENOENT/);
    const stopped = discovery.discoverDockerDatabaseEndpoints(() => ({
      status: 1,
      stdout: '',
      stderr: 'error during connect: the docker daemon is not running\nmore',
    }));
    expect(stopped).toMatchObject({ status: 'unavailable' });
    expect(stopped.detail).toMatch(/exited 1: error during connect/);
    expect(policy.deniedWorkstationDatabasePorts()).toEqual(expect.arrayContaining([5432, 5434, 55432]));
  });
});

describe('registration: what a discovery finds is denied from then on, whatever the opt-in', () => {
  it('this worker ran the real discovery when the guard was installed, and denies all it found', async () => {
    const discovery = await loadDiscovery();
    const state = discovery.dockerDatabaseEndpointDiscoveryState();
    expect(['ok', 'unavailable']).toContain(state.status);
    for (const port of state.deniedPorts) expect(policy.deniedWorkstationDatabasePorts()).toContain(port);
  });

  it('a registered port is refused for an opted-in pg client before any socket', async () => {
    policy.registerLiveDatabaseEndpoints({ ports: [61234], hosts: ['wtdg2-registered-db'] });
    process.env.MIMER_TEST_DB_ALLOW = OPT_IN_DB;
    const sockets = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('WTDG2_SOCKET_CONNECT_REACHED');
    });
    for (const connectionString of [
      `postgresql://u:p@127.0.0.1:61234/${OPT_IN_DB}`,
      `postgresql://u:p@wtdg2-registered-db:5433/${OPT_IN_DB}`,
    ]) {
      const error = await new pg.Client({ connectionString }).connect().then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(String(error?.message)).toMatch(/TEST-DB-GUARD/);
    }
    expect(sockets).not.toHaveBeenCalled();
  });

  it("a raw socket to a registered port is refused and never reaches the (test's own) listener", async () => {
    const server = net.createServer();
    const accepted: number[] = [];
    server.on('connection', (socket) => {
      accepted.push(1);
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      policy.registerLiveDatabaseEndpoints({ ports: [port] });
      process.env.MIMER_TEST_DB_ALLOW = OPT_IN_DB;
      let refusal = '';
      try {
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.on('error', () => undefined);
        await new Promise((resolve) => setTimeout(resolve, 300));
        socket.destroy();
      } catch (error) {
        refusal = String((error as Error).message);
      }
      expect(refusal).toMatch(/TEST-DB-GUARD.*net\.Socket\.connect/);
      expect(accepted).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('a local E2E run is refused on a registered port too', () => {
    policy.registerLiveDatabaseEndpoints({ ports: [5439] });
    expect(() =>
      localE2e.resolveLocalE2eServerPlan({
        PLAYWRIGHT_DATABASE_URL: `postgresql://u:p@127.0.0.1:5439/${OPT_IN_DB}`,
        ...OPT_IN,
      }),
    ).toThrow(/live database port/);
  });
});

function runChild(childCode: string, extraEnv: Record<string, string> = {}): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg2-docker-child-'));
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
  Object.assign(env, extraEnv);
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
    return line.slice('WTDG2_RESULT '.length).trim();
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe('a fresh process: the first discovery is registered with the policy', () => {
  it('ensureDockerDatabaseEndpointDiscovery (faked docker ps) makes its ports and names live', () => {
    const policyUrl = pathToFileURL(
      path.join(REPO_ROOT, 'server/modules/test-db-guard/testDatabaseTargetPolicy.ts'),
    ).href;
    const out = runChild(`
const d = await import(${JSON.stringify(DISCOVERY_URL)});
const p = await import(${JSON.stringify(policyUrl)});
const before = p.evaluateLiveEndpoint('127.0.0.1', 61235) !== null;
// No discovery has run in this process yet: the static list alone names the proof staging DB.
const staticProofDbPort = p.evaluateLiveEndpoint('127.0.0.1', 55432) !== null;
d.ensureDockerDatabaseEndpointDiscovery(() => ({ status: 0, stderr: '',
  stdout: 'wtdg2-fresh-live-db' + String.fromCharCode(9) + '127.0.0.1:61235->5432/tcp' + String.fromCharCode(9) + 'postgres:17' }));
const after = p.evaluateLiveEndpoint('127.0.0.1', 61235) !== null;
const byName = p.evaluateLiveEndpoint('wtdg2-fresh-live-db', 5433) !== null;
process.stdout.write('WTDG2_RESULT ' + JSON.stringify({ staticProofDbPort, before, after, byName }) + String.fromCharCode(10));
process.exit(0);
`);
    expect(JSON.parse(out)).toEqual({ staticProofDbPort: true, before: false, after: true, byName: true });
  });
});

describe('playwright.config.ts asks Docker before it decides anything', () => {
  it('even an external-target run (which installs no guard) has run the discovery', () => {
    const status = runChild(
      `
await import(${JSON.stringify(CONFIG_URL)});
const { dockerDatabaseEndpointDiscoveryState } = await import(${JSON.stringify(DISCOVERY_URL)});
process.stdout.write('WTDG2_RESULT ' + dockerDatabaseEndpointDiscoveryState().status + String.fromCharCode(10));
process.exit(0);
`,
      { PLAYWRIGHT_BASE_URL: 'https://wtdg2-external.invalid' },
    );
    expect(['ok', 'unavailable']).toContain(status);
  });
});
