import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * W-U402 (U40-2, point 1) -- the product runtime's DATABASE_URL is the one injected into the process.
 *
 * Spec U40-U50B §1.3 / owner queue decision ("U40-2 must close the env fallback: DATABASE_URL deletion + localhost:5432
 * fallback"): `server/loadEnvFirst.ts` deleted every injected DATABASE_URL outside a test runtime, so a container that
 * got its DATABASE_URL from the composition (no env file in /app) ran with none, and the database client then fell back
 * to libpq's default (localhost:5432) -- U40-A-DOCKER-VERIFICATION F2. Now:
 *  - a process whose environment is authoritative -- NODE_ENV exactly 'production' or PRESERVE_RUNTIME_ENV exactly
 *    'true', decided on the environment the process was STARTED with, before any env file -- keeps an injected
 *    DATABASE_URL;
 *  - development is unchanged: the inherited DATABASE_URL is deleted and the env files decide, as before;
 *  - (consistency, spec §1.8 "plus server/db/prisma.ts") in such a process outside a test runtime, the database client
 *    refuses to be constructed without a DATABASE_URL (DATABASE_URL_REQUIRED) instead of silently connecting to
 *    libpq's default; development is unchanged there too.
 *
 * Each case runs the REAL module in its own Node process whose cwd is a fresh temporary directory holding FAKE env files
 * with obviously fabricated values (`.invalid` hosts, port 1), with an environment built from scratch. No case opens a
 * database connection: the children only report what ended up in their environment, or whether the import refused.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const PRISMA_MODULE_URL = pathToFileURL(path.join(REPO_ROOT, 'server/db/prisma.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const INJECTED_DATABASE_URL = 'postgresql://u402-injected:x@u402-injected.invalid:1/u402_injected_db';
const FAKE_DOTENV_DATABASE_URL = 'postgresql://u402-dotenv:x@u402-dotenv.invalid:1/u402_dotenv_db';
const FAKE_LOCAL_DATABASE_URL = 'postgresql://u402-local:x@u402-local.invalid:1/u402_local_db';
const DEAD_DATABASE_URL = 'postgresql://u402-dead:x@127.0.0.1:1/u402_dead_db';

type CwdName = 'empty' | 'dotenv' | 'local' | 'both';
const cwds = {} as Record<CwdName, string>;
let scratchRoot: string;

beforeAll(() => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u402-env-cwd-'));
  const dotenv = [`DATABASE_URL=${FAKE_DOTENV_DATABASE_URL}`, 'U402_DOTENV_SENTINEL=loaded-from-the-fake-env'].join('\n');
  const local = [`DATABASE_URL=${FAKE_LOCAL_DATABASE_URL}`, 'U402_LOCAL_SENTINEL=loaded-from-the-fake-env-local'].join('\n');
  const files: Record<CwdName, Record<string, string>> = {
    empty: {},
    dotenv: { '.env': dotenv },
    local: { '.env.local': local },
    both: { '.env': dotenv, '.env.local': local },
  };
  for (const name of Object.keys(files) as CwdName[]) {
    const dir = path.join(scratchRoot, name);
    fs.mkdirSync(dir);
    for (const [file, content] of Object.entries(files[name])) fs.writeFileSync(path.join(dir, file), content, 'utf8');
    cwds[name] = dir;
  }
});

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

/** Only what Node and tsx need to start on this platform. Nothing else is inherited (no VITEST, no NODE_ENV). */
function bareChildEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

type LoadEnvReport = { DATABASE_URL: string | null; U402_DOTENV_SENTINEL: string | null; U402_LOCAL_SENTINEL: string | null };

function runLoadEnvFirst(cwd: CwdName, extraEnv: Record<string, string>): LoadEnvReport {
  const childCode = [
    `await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});`,
    'const pick = (k) => (process.env[k] === undefined ? null : process.env[k]);',
    "const report = { DATABASE_URL: pick('DATABASE_URL'), U402_DOTENV_SENTINEL: pick('U402_DOTENV_SENTINEL'), U402_LOCAL_SENTINEL: pick('U402_LOCAL_SENTINEL') };",
    "process.stdout.write('U402_RESULT ' + JSON.stringify(report) + '\\n');",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--import', TSX_LOADER_URL, '--input-type=module', '-e', childCode], {
    cwd: cwds[cwd],
    env: bareChildEnv(extraEnv),
    encoding: 'utf8',
    timeout: 60_000,
  });
  const line = (result.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('U402_RESULT '));
  if (result.status !== 0 || !line) {
    throw new Error(`child loadEnvFirst run failed (status ${result.status}): ${String(result.stderr ?? '').slice(0, 2000)}`);
  }
  return JSON.parse(line.slice('U402_RESULT '.length)) as LoadEnvReport;
}

type PrismaImport = { imported: boolean; status: number | null; stderr: string };

function importPrismaModule(cwd: CwdName, extraEnv: Record<string, string>): PrismaImport {
  const childCode = [
    `await import(${JSON.stringify(PRISMA_MODULE_URL)});`,
    "process.stdout.write('U402_IMPORTED\\n');",
    'process.exit(0);',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--import', TSX_LOADER_URL, '--input-type=module', '-e', childCode], {
    cwd: cwds[cwd],
    env: bareChildEnv(extraEnv),
    encoding: 'utf8',
    timeout: 90_000,
  });
  const imported = (result.stdout ?? '').split(/\r?\n/).includes('U402_IMPORTED');
  return { imported, status: result.status, stderr: String(result.stderr ?? '') };
}

describe('loadEnvFirst keeps an injected DATABASE_URL where the process environment is authoritative', () => {
  it('NODE_ENV=production, no env file (the container): the injected DATABASE_URL stays', () => {
    const report = runLoadEnvFirst('empty', { NODE_ENV: 'production', DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBe(INJECTED_DATABASE_URL);
  });

  it('NODE_ENV=production with a .env naming another database: the injected one stays, .env still loads its other keys', () => {
    const report = runLoadEnvFirst('dotenv', { NODE_ENV: 'production', DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBe(INJECTED_DATABASE_URL);
    expect(report.U402_DOTENV_SENTINEL).toBe('loaded-from-the-fake-env');
  });

  it('PRESERVE_RUNTIME_ENV=true (development) with a .env.local naming another database: the injected one stays', () => {
    const report = runLoadEnvFirst('local', {
      NODE_ENV: 'development',
      PRESERVE_RUNTIME_ENV: 'true',
      DATABASE_URL: INJECTED_DATABASE_URL,
    });
    expect(report.DATABASE_URL).toBe(INJECTED_DATABASE_URL);
    expect(report.U402_LOCAL_SENTINEL).toBe('loaded-from-the-fake-env-local');
  });

  it('PRESERVE_RUNTIME_ENV=true, NODE_ENV unset, .env and .env.local both naming other databases: the injected one stays', () => {
    const report = runLoadEnvFirst('both', { PRESERVE_RUNTIME_ENV: 'true', DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBe(INJECTED_DATABASE_URL);
  });
});

describe('loadEnvFirst outside an authoritative environment is unchanged (development)', () => {
  it('NODE_ENV=development: the inherited DATABASE_URL is deleted and .env.local decides, as before', () => {
    const report = runLoadEnvFirst('local', { NODE_ENV: 'development', DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBe(FAKE_LOCAL_DATABASE_URL);
  });

  it('NODE_ENV unset: the inherited DATABASE_URL is deleted and .env decides, as before', () => {
    const report = runLoadEnvFirst('dotenv', { DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBe(FAKE_DOTENV_DATABASE_URL);
  });

  it('NODE_ENV=development, no env file: the inherited DATABASE_URL is deleted, nothing refills it, as before', () => {
    const report = runLoadEnvFirst('empty', { NODE_ENV: 'development', DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBeNull();
  });

  it.each([['false'], ['TRUE'], ['1'], ['']])(
    'PRESERVE_RUNTIME_ENV=%j is not "true" (exact): deleted as before',
    (preserve) => {
      const report = runLoadEnvFirst('empty', {
        NODE_ENV: 'development',
        PRESERVE_RUNTIME_ENV: preserve,
        DATABASE_URL: INJECTED_DATABASE_URL,
      });
      expect(report.DATABASE_URL).toBeNull();
    },
  );

  it.each([['Production'], ['prod'], ['staging']])('NODE_ENV=%s is not "production" (exact): deleted as before', (nodeEnv) => {
    const report = runLoadEnvFirst('empty', { NODE_ENV: nodeEnv, DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBeNull();
  });

  it('NODE_ENV=production WITHOUT PRESERVE_RUNTIME_ENV: a .env.local in the cwd still overrides, as before (not deleted, overridden)', () => {
    const report = runLoadEnvFirst('local', { NODE_ENV: 'production', DATABASE_URL: INJECTED_DATABASE_URL });
    expect(report.DATABASE_URL).toBe(FAKE_LOCAL_DATABASE_URL);
  });
});

describe('server/db/prisma: no libpq localhost default where the process environment is authoritative', () => {
  it('NODE_ENV=production without DATABASE_URL: the client refuses to be constructed (DATABASE_URL_REQUIRED)', () => {
    const r = importPrismaModule('empty', { NODE_ENV: 'production' });
    expect(r.imported, r.stderr.slice(0, 1500)).toBe(false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/DATABASE_URL_REQUIRED: /);
  });

  it('NODE_ENV=production with a blank DATABASE_URL: refuses (DATABASE_URL_REQUIRED)', () => {
    const r = importPrismaModule('empty', { NODE_ENV: 'production', DATABASE_URL: '   ' });
    expect(r.imported, r.stderr.slice(0, 1500)).toBe(false);
    expect(r.stderr).toMatch(/DATABASE_URL_REQUIRED: /);
  });

  it('PRESERVE_RUNTIME_ENV=true without DATABASE_URL: refuses (DATABASE_URL_REQUIRED)', () => {
    const r = importPrismaModule('empty', { NODE_ENV: 'development', PRESERVE_RUNTIME_ENV: 'true' });
    expect(r.imported, r.stderr.slice(0, 1500)).toBe(false);
    expect(r.stderr).toMatch(/DATABASE_URL_REQUIRED: /);
  });

  it('NODE_ENV=production with an explicit (dead) DATABASE_URL: constructed without connecting, unchanged', () => {
    const r = importPrismaModule('empty', { NODE_ENV: 'production', DATABASE_URL: DEAD_DATABASE_URL });
    expect(r.imported, r.stderr.slice(0, 1500)).toBe(true);
  });

  it('NODE_ENV=production, DATABASE_URL only in the cwd .env.local: the env file is still read, constructed, unchanged', () => {
    const r = importPrismaModule('local', { NODE_ENV: 'production' });
    expect(r.imported, r.stderr.slice(0, 1500)).toBe(true);
  });

  it('NODE_ENV=development without DATABASE_URL: unchanged (constructed; no connection at import)', () => {
    const r = importPrismaModule('empty', { NODE_ENV: 'development' });
    expect(r.imported, r.stderr.slice(0, 1500)).toBe(true);
  });
});

describe('the rule, in one place (server/modules/runtime-env/runtimeDatabaseUrl.ts)', () => {
  // Loaded lazily (computed specifier) so that, before the module exists, only these two cases are red and the
  // behavioural cases above still run.
  const RULE_MODULE = pathToFileURL(path.join(REPO_ROOT, 'server/modules/runtime-env/runtimeDatabaseUrl.ts')).href;
  const load = (): Promise<typeof import('../../server/modules/runtime-env/runtimeDatabaseUrl')> =>
    import(/* @vite-ignore */ RULE_MODULE);

  it('an authoritative environment is NODE_ENV exactly "production" or PRESERVE_RUNTIME_ENV exactly "true"', async () => {
    const { isRuntimeEnvironmentAuthoritative } = await load();
    const table: Array<[Record<string, string>, boolean]> = [
      [{ NODE_ENV: 'production' }, true],
      [{ PRESERVE_RUNTIME_ENV: 'true' }, true],
      [{ NODE_ENV: 'development', PRESERVE_RUNTIME_ENV: 'true' }, true],
      [{}, false],
      [{ NODE_ENV: 'development' }, false],
      [{ NODE_ENV: 'test' }, false],
      [{ NODE_ENV: 'Production' }, false],
      [{ NODE_ENV: ' production' }, false],
      [{ PRESERVE_RUNTIME_ENV: 'false' }, false],
      [{ PRESERVE_RUNTIME_ENV: 'TRUE' }, false],
      [{ PRESERVE_RUNTIME_ENV: '1' }, false],
      [{ PRESERVE_RUNTIME_ENV: '' }, false],
    ];
    for (const [env, expected] of table) expect(isRuntimeEnvironmentAuthoritative(env), JSON.stringify(env)).toBe(expected);
  });

  it('requireDatabaseUrl returns the value unchanged, or refuses with DATABASE_URL_REQUIRED naming the consumer and no value', async () => {
    const { requireDatabaseUrl, DATABASE_URL_REQUIRED } = await load();
    expect(requireDatabaseUrl({ DATABASE_URL: DEAD_DATABASE_URL }, 'c')).toBe(DEAD_DATABASE_URL);
    for (const value of [undefined, '', '   ', '\t\r\n']) {
      let caught: unknown;
      try {
        requireDatabaseUrl(value === undefined ? {} : { DATABASE_URL: value }, 'the test consumer');
      } catch (error) {
        caught = error;
      }
      expect(caught, JSON.stringify(value)).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBe(DATABASE_URL_REQUIRED);
      expect((caught as Error).message).toMatch(/^DATABASE_URL_REQUIRED: .*the test consumer/);
      expect((caught as Error).message).not.toMatch(/postgres(ql)?:\/\//);
    }
  });
});
