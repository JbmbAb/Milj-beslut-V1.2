import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  describeDatabaseTarget,
  evaluateLiveEndpoint,
  evaluateTestDatabaseTarget,
  isHermeticTestProcess,
  isLocalEnvFile,
  isTestRuntime,
  noteTestEnvFileGuard,
  splitDatabaseConnectionEntries,
  TestDatabaseTargetRefusedError,
} from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5): connection-time enforcement in a TEST RUNTIME. Installed by the first
 * Vitest setup file of every project (tests/setup/testDatabaseGuard.ts), by the integration
 * globalSetup, by server/loadEnvFirst.ts and server/db/prisma.ts when they are loaded in a test
 * runtime, and by playwright.config.ts for a local E2E run. Idempotent.
 *
 *   - pg.Client.prototype.connect: refuses every target that is not explicitly dead or opted in
 *     (policy in testDatabaseTargetPolicy.ts) BEFORE pg creates its connection; pg.Pool and
 *     Prisma's adapter-pg connect through it, so they are covered too.
 *   - net.Socket.prototype.connect: refuses any socket to a denylisted live endpoint, for any
 *     other client (postgres.js, a raw socket, ...). It throws before the socket connects.
 *   - dotenv's configDotenv: in a test runtime never reads a `*.local` env file and drops database
 *     connection keys from every other env file (so `dotenv.config()`, `import 'dotenv/config'`
 *     and `config({ path: '.env.test' })` in the test chain follow the same rule as loadEnvFile);
 *     in a process marked MIMER_TEST_MODE it reads no env file at all.
 *
 * Never installed outside a test runtime by product code; non-test behaviour is unchanged.
 */

const GUARD_MARK = Symbol.for('mimer.testDbGuard.installed');

type Marked = { [GUARD_MARK]?: true };
type PgClientLike = {
  host?: unknown;
  port?: unknown;
  database?: unknown;
  connect: (...args: unknown[]) => unknown;
};
type DotenvOptions = {
  path?: string | string[];
  encoding?: BufferEncoding;
  processEnv?: NodeJS.ProcessEnv;
  override?: boolean;
};
type DotenvLike = Marked & {
  configDotenv: (options?: DotenvOptions) => unknown;
  parse: (src: string | Buffer) => Record<string, string>;
  populate: (
    target: Record<string, unknown>,
    parsed: Record<string, string>,
    options?: DotenvOptions,
  ) => unknown;
};

/**
 * The REAL pg, through Node's own module cache -- the same instance that `import pg from 'pg'`,
 * pg's ESM wrapper and @prisma/adapter-pg resolve to. Deliberately not a static import: a test
 * that vi.mock('pg')s must not get its mock patched, and the real one must be patched regardless.
 */
function realPgClientPrototype(): (PgClientLike & Marked) | null {
  try {
    const realPg = createRequire(import.meta.url)('pg') as { Client?: unknown };
    const Client = realPg?.Client as { prototype?: PgClientLike & Marked } | undefined;
    const proto = Client?.prototype;
    return proto && typeof proto.connect === 'function' ? proto : null;
  } catch {
    return null; // pg not installed: no pg connection can be made
  }
}

function guardPgClientConnect(): void {
  const proto = realPgClientPrototype();
  if (!proto || proto[GUARD_MARK]) return;
  const original = proto.connect;
  proto.connect = function guardedPgClientConnect(this: PgClientLike, ...args: unknown[]): unknown {
    const target = {
      host: String(this.host ?? ''),
      port: Number(this.port),
      database: String(this.database ?? ''),
    };
    const verdict = evaluateTestDatabaseTarget(target, process.env);
    if (!verdict.allowed) {
      const error = new TestDatabaseTargetRefusedError(
        'pg.Client.connect',
        describeDatabaseTarget(target),
        verdict.reason,
      );
      const callback = args[0];
      if (typeof callback === 'function') {
        process.nextTick(callback as (err: Error) => void, error);
        return undefined;
      }
      return Promise.reject(error);
    }
    return original.apply(this, args);
  };
  Object.defineProperty(proto, GUARD_MARK, { value: true });
}

/** Node's connect accepts (options), (path), (port, host) or its own normalized [options, cb]. */
function socketEndpointOf(args: unknown[]): { host?: string; port: number | null; path?: string } {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') {
    const options = first as { host?: unknown; port?: unknown; path?: unknown };
    if (typeof options.path === 'string' && options.path) return { path: options.path, port: null };
    const port = Number(options.port);
    return {
      host: typeof options.host === 'string' ? options.host : undefined,
      port: Number.isFinite(port) && port > 0 ? port : null,
    };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first, port: null };
  const port = Number(first);
  return {
    host: typeof args[1] === 'string' ? args[1] : undefined,
    port: Number.isFinite(port) && port > 0 ? port : null,
  };
}

function guardSocketConnect(): void {
  const proto = net.Socket.prototype as unknown as Marked & { connect: (...args: unknown[]) => unknown };
  if (proto[GUARD_MARK]) return;
  const original = proto.connect;
  proto.connect = function guardedSocketConnect(this: net.Socket, ...args: unknown[]): unknown {
    const endpoint = socketEndpointOf(args);
    const live = endpoint.path
      ? evaluateLiveEndpoint(endpoint.path, null)
      : evaluateLiveEndpoint(endpoint.host, endpoint.port);
    if (live) {
      const where = endpoint.path ?? `${endpoint.host ?? 'localhost'}:${endpoint.port ?? '?'}`;
      throw new TestDatabaseTargetRefusedError('net.Socket.connect', where, live.reason);
    }
    return original.apply(this, args);
  };
  Object.defineProperty(proto, GUARD_MARK, { value: true });
}

function dotenvPathsOf(options?: DotenvOptions): string[] {
  const resolveHome = (p: string) => (p[0] === '~' ? path.join(os.homedir(), p.slice(1)) : p);
  if (!options?.path) return [path.resolve(process.cwd(), '.env')];
  return Array.isArray(options.path) ? options.path.map(resolveHome) : [resolveHome(options.path)];
}

function guardDotenvFileLoading(): void {
  let dotenv: DotenvLike;
  try {
    dotenv = createRequire(import.meta.url)('dotenv') as DotenvLike;
  } catch {
    return; // dotenv not installed: nothing to guard
  }
  if (dotenv[GUARD_MARK]) return;
  const original = dotenv.configDotenv;
  dotenv.configDotenv = function guardedConfigDotenv(options?: DotenvOptions): unknown {
    if (!isTestRuntime(process.env)) return original.call(dotenv, options);
    const target = (options?.processEnv ?? process.env) as Record<string, unknown>;
    const parsedAll: Record<string, string> = {};
    let lastError: unknown;
    const hermetic = isHermeticTestProcess(process.env);
    for (const filePath of dotenvPathsOf(options)) {
      if (hermetic) {
        noteTestEnvFileGuard(filePath, 'MIMER_TEST_MODE: no env file is read in a marked test process');
        continue;
      }
      if (isLocalEnvFile(filePath)) {
        noteTestEnvFileGuard(filePath, 'a *.local env file is never read in a test runtime');
        continue;
      }
      let parsed: Record<string, string>;
      try {
        parsed = dotenv.parse(fs.readFileSync(filePath, { encoding: options?.encoding ?? 'utf8' }));
      } catch (error) {
        lastError = error;
        continue;
      }
      const { kept, dropped } = splitDatabaseConnectionEntries(parsed);
      if (dropped.length > 0) {
        noteTestEnvFileGuard(
          filePath,
          `database connection keys not loaded in a test runtime: ${dropped.join(', ')}`,
        );
      }
      dotenv.populate(parsedAll, kept, options);
    }
    dotenv.populate(target, parsedAll, options);
    return lastError ? { parsed: parsedAll, error: lastError } : { parsed: parsedAll };
  };
  Object.defineProperty(dotenv, GUARD_MARK, { value: true });
}

export function installTestDatabaseConnectionGuard(): void {
  guardPgClientConnect();
  guardSocketConnect();
  guardDotenvFileLoading();
}

/** For the proof tests: which of the three layers are installed in this process. */
export function testDatabaseConnectionGuardState(): { pg: boolean; socket: boolean; dotenv: boolean } {
  let dotenvMarked = false;
  try {
    dotenvMarked = Boolean((createRequire(import.meta.url)('dotenv') as DotenvLike)[GUARD_MARK]);
  } catch {
    dotenvMarked = false;
  }
  return {
    pg: Boolean(realPgClientPrototype()?.[GUARD_MARK]),
    socket: Boolean((net.Socket.prototype as unknown as Marked)[GUARD_MARK]),
    dotenv: dotenvMarked,
  };
}
