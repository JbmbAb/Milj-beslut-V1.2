// @vitest-environment node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import dotenv, { config as dotenvConfigNamedImport } from 'dotenv';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseConnectionGuardState } from '../../server/modules/test-db-guard/installTestDatabaseConnectionGuard';
import {
  assertNoKnownLiveDatabaseInEnv,
  evaluateLiveEndpoint,
  evaluateTestDatabaseTarget,
  parseDatabaseUrlTarget,
  type DatabaseTarget,
} from '../../server/modules/test-db-guard/testDatabaseTargetPolicy';
import vitestConfig from '../../vitest.config';

/**
 * TEST-DB-GUARD (OD-K0-5), requirement 2: in a test runtime every database connection is refused
 * unless its target is explicitly dead or explicitly opted in, known live/staging targets are
 * denied with a clear error, and the refusal happens before any socket is opened.
 *
 * No case here can reach a database, even with the guard removed (mutation runs): every pg/Prisma
 * case runs with net.Socket.prototype.connect replaced by a spy that throws instead of connecting,
 * denylisted targets sit on dead port 1 where possible, and the raw-socket case uses a host that
 * does not resolve plus a lookup function that fails. The spy doubles as the detector: a refused
 * connection must never reach it, an allowed one must.
 */

const GUARD_SETUP = 'tests/setup/testDatabaseGuard.ts';
const SOCKET_SENTINEL = 'WTDG_SOCKET_CONNECT_REACHED';
const savedEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

function blockAllSockets() {
  return vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error(SOCKET_SENTINEL);
  });
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    parts.push(String((current as Error).message ?? current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return errorText(error);
  }
  throw new Error('expected a rejection');
}

const target = (host: string, port: number, database: string): DatabaseTarget => ({ host, port, database });

describe('policy: what a test runtime may reach', () => {
  it.each<[string, DatabaseTarget, NodeJS.ProcessEnv]>([
    ['the live database name, even on a dead port', target('127.0.0.1', 1, 'miljobeslut'), {}],
    [
      'the live database name, opted in',
      target('127.0.0.1', 5433, 'miljobeslut'),
      { MIMER_TEST_DB_ALLOW: 'miljobeslut' },
    ],
    ['the production database name', target('127.0.0.1', 5433, 'miljobeslut_prod'), {}],
    ['the staging database name', target('localhost', 5433, 'miljobeslut_staging'), {}],
    [
      'live port 5432 on loopback, even opted in',
      target('127.0.0.1', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'live port 5432 via localhost',
      target('localhost', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'live port 5432 via [::1]',
      target('[::1]', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'live port 5432 via 0.0.0.0',
      target('0.0.0.0', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      "live port 5432 via this machine's own hostname",
      target(os.hostname(), 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'prod compose port 5434 on loopback',
      target('127.0.0.1', 5434, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'container miljobeslut-postgres',
      target('miljobeslut-postgres', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'container i2dbprefneg-postgres',
      target('i2dbprefneg-postgres', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'container i2dbpref4f4a-postgres',
      target('i2dbpref4f4a-postgres', 6543, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'the Cloud SQL socket',
      target('/cloudsql/proj:europe-west1:miljobeslut-db', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
    [
      'staging compose host db',
      target('db', 5432, 'riskguard_test'),
      { MIMER_TEST_DB_ALLOW: 'riskguard_test' },
    ],
  ])('denylisted: %s', (_label, t, env) => {
    const verdict = evaluateTestDatabaseTarget(t, env);
    expect(verdict.allowed).toBe(false);
    expect(verdict.denylist).not.toBeNull();
  });

  it.each<[string, DatabaseTarget]>([
    ['127.0.0.1:1', target('127.0.0.1', 1, 'none')],
    ['localhost:1', target('localhost', 1, 'none')],
    ['[::1]:1', target('[::1]', 1, 'none')],
    ['a *.invalid host', target('wtdg-guard.invalid', 5432, 'anything')],
  ])('allowed without opt-in, explicitly dead: %s', (_label, t) => {
    expect(evaluateTestDatabaseTarget(t, {})).toMatchObject({ allowed: true, basis: 'dead-target' });
  });

  it('refuses a reachable-looking target without the opt-in', () => {
    const verdict = evaluateTestDatabaseTarget(target('127.0.0.1', 5433, 'wtdg_guard_test'), {});
    expect(verdict).toMatchObject({ allowed: false, denylist: null });
  });

  it('the opt-in must match the *_test pattern', () => {
    const verdict = evaluateTestDatabaseTarget(target('127.0.0.1', 5433, 'wtdg_scratch'), {
      MIMER_TEST_DB_ALLOW: 'wtdg_scratch',
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/\*_test/);
  });

  it('the opt-in must name exactly the targeted database', () => {
    const verdict = evaluateTestDatabaseTarget(target('127.0.0.1', 5433, 'other_test'), {
      MIMER_TEST_DB_ALLOW: 'wtdg_guard_test',
    });
    expect(verdict.allowed).toBe(false);
  });

  it('admits an opted-in *_test database on a non-live host/port', () => {
    expect(
      evaluateTestDatabaseTarget(target('127.0.0.1', 5433, 'wtdg_guard_test'), {
        MIMER_TEST_DB_ALLOW: 'wtdg_guard_test',
      }),
    ).toMatchObject({ allowed: true, basis: 'explicit-opt-in' });
  });

  it('parses the socket override the way pg does', () => {
    expect(
      parseDatabaseUrlTarget(
        'postgresql://u:p@localhost/miljobeslut_prod?host=/cloudsql/p:europe-west1:miljobeslut-db',
      ),
    ).toEqual({ host: '/cloudsql/p:europe-west1:miljobeslut-db', port: 5432, database: 'miljobeslut_prod' });
  });

  it('socket-level denylist: live workstation ports and live hosts, never a random port', () => {
    expect(evaluateLiveEndpoint('127.0.0.1', 5432)).not.toBeNull();
    expect(evaluateLiveEndpoint('localhost', 5434)).not.toBeNull();
    expect(evaluateLiveEndpoint('i2dbpref4f4a-postgres', 80)).not.toBeNull();
    expect(evaluateLiveEndpoint('127.0.0.1', 8787)).toBeNull();
    expect(evaluateLiveEndpoint('127.0.0.1', 5433)).toBeNull();
    expect(evaluateLiveEndpoint('localhost', null)).toBeNull();
  });
});

describe('startup check: a test run refuses an environment that names a live database', () => {
  it.each<[string, NodeJS.ProcessEnv]>([
    ['DATABASE_URL on the live name', { DATABASE_URL: 'postgresql://u:p@localhost:5432/miljobeslut' }],
    ['any URL-valued key on a live host', { SOME_URL: 'postgres://u:p@miljobeslut-postgres:5432/x_test' }],
    ['PGHOST on a live host', { PGHOST: 'i2dbprefneg-postgres', PGDATABASE: 'x' }],
    ['a remote managed database', { DATABASE_URL: 'prisma://accelerate.invalid/?api_key=x' }],
  ])('refuses: %s', (_label, env) => {
    expect(() => assertNoKnownLiveDatabaseInEnv(env, 'wtdg-test')).toThrow(/TEST-DB-GUARD/);
  });

  it('leaves a merely not-opted-in target (e.g. CI service DB) to the connect check', () => {
    expect(() =>
      assertNoKnownLiveDatabaseInEnv(
        { DATABASE_URL: 'postgresql://u:p@localhost:5432/riskguard_test' },
        'wtdg-test',
      ),
    ).not.toThrow();
    expect(() =>
      assertNoKnownLiveDatabaseInEnv({ DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none' }, 'wtdg-test'),
    ).not.toThrow();
  });
});

describe('the guard is installed in every test worker by the setup file, not by the test', () => {
  it('pg, socket and dotenv layers are active in this worker without this file installing them', () => {
    expect(testDatabaseConnectionGuardState()).toEqual({ pg: true, socket: true, dotenv: true });
  });

  it('every Vitest project runs the guard setup first and lets Vite read no env file', () => {
    const config = vitestConfig as unknown as {
      envDir?: unknown;
      test: {
        setupFiles: string[];
        projects: Array<{ envDir?: unknown; test: { name: string; setupFiles: string[] } }>;
      };
    };
    expect(config.envDir).toBe(false);
    expect(config.test.setupFiles[0]).toBe(GUARD_SETUP);
    expect(config.test.projects.map((p) => p.test.name).sort()).toEqual([
      'compliance',
      'component',
      'integration',
      'unit',
    ]);
    for (const project of config.test.projects) {
      expect({ name: project.test.name, first: project.test.setupFiles[0] }).toEqual({
        name: project.test.name,
        first: GUARD_SETUP,
      });
      expect({ name: project.test.name, envDir: project.envDir }).toEqual({
        name: project.test.name,
        envDir: false,
      });
    }
  });
});

describe('connect check: refused before any socket is opened', () => {
  it('pg.Client to a denylisted database is refused, the socket is never touched', async () => {
    const sockets = blockAllSockets();
    const client = new pg.Client({ connectionString: 'postgresql://wtdg:wtdg@127.0.0.1:1/miljobeslut' });

    expect(await rejectionOf(client.connect())).toMatch(/TEST-DB-GUARD.*pg\.Client\.connect.*miljobeslut/);
    expect(sockets).not.toHaveBeenCalled();
  });

  it('pg.Client with a callback gets the refusal through the callback', async () => {
    const sockets = blockAllSockets();
    const client = new pg.Client({
      connectionString: 'postgresql://wtdg:wtdg@127.0.0.1:2/wtdg_not_opted_in_test',
    });

    const error = await new Promise<Error | null>((resolve) => client.connect((err) => resolve(err ?? null)));
    expect(errorText(error)).toMatch(/TEST-DB-GUARD/);
    expect(sockets).not.toHaveBeenCalled();
  });

  it('pg.Pool to a not-opted-in database is refused, the socket is never touched', async () => {
    const sockets = blockAllSockets();
    const pool = new pg.Pool({
      connectionString: 'postgresql://wtdg:wtdg@127.0.0.1:2/wtdg_not_opted_in_test',
    });
    try {
      expect(await rejectionOf(pool.query('SELECT 1'))).toMatch(
        /TEST-DB-GUARD.*MIMER_TEST_DB_ALLOW is not set/,
      );
      expect(sockets).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });

  it('denylist beats the opt-in: live port 5432 is refused even when opted in', async () => {
    process.env.MIMER_TEST_DB_ALLOW = 'riskguard_test';
    const sockets = blockAllSockets();
    const client = new pg.Client({
      connectionString: 'postgresql://wtdg:wtdg@127.0.0.1:5432/riskguard_test',
    });

    expect(await rejectionOf(client.connect())).toMatch(/TEST-DB-GUARD.*live database port/);
    expect(sockets).not.toHaveBeenCalled();
  });

  it('Prisma (adapter-pg) to a denylisted database is refused, the socket is never touched', async () => {
    const sockets = blockAllSockets();
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: 'postgresql://wtdg:wtdg@127.0.0.1:1/miljobeslut' }),
    });
    try {
      expect(await rejectionOf(prisma.$queryRawUnsafe('SELECT 1'))).toMatch(/TEST-DB-GUARD/);
      expect(sockets).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  });

  it('the product Prisma singleton (server/db/prisma) refuses a denylisted DATABASE_URL before any socket', async () => {
    const g = globalThis as { __miljobeslutPrisma?: unknown };
    const previous = g.__miljobeslutPrisma;
    delete g.__miljobeslutPrisma;
    process.env.DATABASE_URL = 'postgresql://wtdg:wtdg@127.0.0.1:1/miljobeslut';
    const sockets = blockAllSockets();
    vi.resetModules();
    try {
      const { prisma } = await import('../../server/db/prisma');
      expect(await rejectionOf(prisma.$queryRawUnsafe('SELECT 1'))).toMatch(/TEST-DB-GUARD/);
      expect(sockets).not.toHaveBeenCalled();
      await prisma.$disconnect().catch(() => undefined);
    } finally {
      g.__miljobeslutPrisma = previous;
      if (previous === undefined) delete g.__miljobeslutPrisma;
    }
  });

  it('the product Prisma singleton refuses a remote managed database (accelerateUrl) in a test runtime', async () => {
    const g = globalThis as { __miljobeslutPrisma?: unknown };
    const previous = g.__miljobeslutPrisma;
    delete g.__miljobeslutPrisma;
    process.env.DATABASE_URL = 'prisma://wtdg-accelerate.invalid/?api_key=wtdg-not-a-key';
    vi.resetModules();
    try {
      expect(await rejectionOf(import('../../server/db/prisma'))).toMatch(/TEST-DB-GUARD.*remote managed/);
    } finally {
      g.__miljobeslutPrisma = previous;
      if (previous === undefined) delete g.__miljobeslutPrisma;
    }
  });

  it('positive control: an explicitly dead target passes the guard and reaches the (blocked) socket', async () => {
    const sockets = blockAllSockets();
    const client = new pg.Client({ connectionString: 'postgresql://x:x@127.0.0.1:1/none' });

    expect(await rejectionOf(client.connect())).toMatch(SOCKET_SENTINEL);
    expect(sockets).toHaveBeenCalled();
  });

  it('positive control: an opted-in *_test database passes the guard and reaches the (blocked) socket', async () => {
    process.env.MIMER_TEST_DB_ALLOW = 'wtdg_guard_test';
    const sockets = blockAllSockets();
    const client = new pg.Client({ connectionString: 'postgresql://x:x@127.0.0.1:2/wtdg_guard_test' });

    expect(await rejectionOf(client.connect())).toMatch(SOCKET_SENTINEL);
    expect(sockets).toHaveBeenCalled();
  });
});

describe('socket check: any other client is refused on a live endpoint', () => {
  it('a raw socket to a live database host throws before connecting or even resolving', () => {
    const lookup = vi.fn((_host: string, _options: unknown, callback: (err: Error) => void) =>
      callback(new Error('WTDG_LOOKUP_REACHED')),
    );
    const socket = new net.Socket();
    socket.on('error', () => undefined);
    try {
      expect(() =>
        socket.connect({
          host: 'i2dbprefneg-postgres',
          port: 5432,
          lookup,
        } as unknown as net.SocketConnectOpts),
      ).toThrow(/TEST-DB-GUARD.*net\.Socket\.connect/);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      socket.destroy();
    }
  });
});

describe('dotenv in the test chain follows the same env-file rule', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function fixtureDir(): { dir: string; local: string; plain: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg-dotenv-'));
    tempDirs.push(dir);
    const local = path.join(dir, '.env.local');
    const plain = path.join(dir, '.env.wtdg');
    fs.writeFileSync(local, 'WTDG_DOTENV_LOCAL=loaded\nDATABASE_URL=postgresql://f:f@wtdg-f.invalid:1/f\n');
    fs.writeFileSync(
      plain,
      'DATABASE_URL=postgresql://f:f@wtdg-f.invalid:1/f\nMIMER_TEST_DB_ALLOW=f_test\nWTDG_DOTENV_PLAIN=kept\n',
    );
    return { dir, local, plain };
  }

  it.each([
    ['named import config()', (o: object) => dotenvConfigNamedImport(o)],
    ['default export dotenv.config()', (o: object) => dotenv.config(o)],
  ])('%s never reads *.local and drops database keys and the opt-in', (_label, load) => {
    const { local, plain } = fixtureDir();
    process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/none';
    delete process.env.WTDG_DOTENV_LOCAL;
    delete process.env.WTDG_DOTENV_PLAIN;
    delete process.env.MIMER_TEST_DB_ALLOW;
    const readSpy = vi.spyOn(fs, 'readFileSync');

    load({ path: [local, plain], override: true, quiet: true });

    expect(process.env.WTDG_DOTENV_PLAIN).toBe('kept');
    expect(process.env.DATABASE_URL).toBe('postgresql://x:x@127.0.0.1:1/none');
    expect(process.env.MIMER_TEST_DB_ALLOW).toBeUndefined();
    expect(process.env.WTDG_DOTENV_LOCAL).toBeUndefined();
    expect(readSpy.mock.calls.some(([p]) => String(p).endsWith('.env.local'))).toBe(false);
  });
});
