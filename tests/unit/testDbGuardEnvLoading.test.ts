import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TEST-DB-GUARD (OD-K0-5), requirement 1: a test runtime never loads `.env.local`, never takes
 * database connection settings from any other env file, and never deletes or overrides an
 * explicitly set DATABASE_URL / TEST_DATABASE_URL.
 *
 * Each case runs the REAL `server/loadEnvFirst.ts` in its own Node process whose cwd is a fresh
 * temporary directory holding FAKE env files with obviously fabricated values, and whose
 * environment is built from scratch (nothing inherited from this process except what Node needs
 * to start). The repository's own `.env.local` is never opened: it is not in the child's cwd,
 * and nothing in this file names it. No case opens a database connection; the child only
 * reports what ended up in its environment.
 *
 * RED/GREEN: run against the parent of the guard commit, the `test runtime` cases fail (the old
 * path deleted DATABASE_URL and refilled it from the fake `.env.local`); against the guard they
 * pass. The `non-test runtime` cases pass on both sides: dev/staging/prod loading is unchanged.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** Deliberately unreachable and obviously fabricated: `.invalid` never resolves, port 1 is dead. */
const FAKE_LOCAL_DATABASE_URL =
  'postgresql://wtdg-fabricated-user:wtdg-not-a-password@wtdg-fabricated-local.invalid:1/wtdg_fabricated_local_db';
const FAKE_DOTENV_TEST_DATABASE_URL =
  'postgresql://wtdg-fabricated-user:wtdg-not-a-password@wtdg-fabricated-dotenv.invalid:1/wtdg_fabricated_dotenv_db';
const EXPLICIT_DEAD_DATABASE_URL = 'postgresql://wtdg-explicit:x@127.0.0.1:1/wtdg_explicit_dead';
const EXPLICIT_DEAD_TEST_DATABASE_URL = 'postgresql://wtdg-explicit:x@127.0.0.1:1/wtdg_explicit_dead_test';

type ChildEnvReport = {
  DATABASE_URL: string | null;
  TEST_DATABASE_URL: string | null;
  WTDG_LOCAL_SENTINEL: string | null;
  WTDG_DOTENV_SENTINEL: string | null;
};

let fakeCwd: string;

beforeAll(() => {
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg-fake-env-cwd-'));
  fs.writeFileSync(
    path.join(fakeCwd, '.env.local'),
    [
      `DATABASE_URL=${FAKE_LOCAL_DATABASE_URL}`,
      `TEST_DATABASE_URL=${FAKE_LOCAL_DATABASE_URL}`,
      'WTDG_LOCAL_SENTINEL=loaded-from-the-fake-env-local',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(fakeCwd, '.env'),
    [`TEST_DATABASE_URL=${FAKE_DOTENV_TEST_DATABASE_URL}`, 'WTDG_DOTENV_SENTINEL=loaded-from-the-fake-env'].join(
      '\n',
    ),
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(fakeCwd, { recursive: true, force: true });
});

/** Only what Node and tsx need to start on this platform. Nothing else is inherited. */
function bareChildEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

function runLoadEnvFirstInChild(extraEnv: Record<string, string>): ChildEnvReport {
  const childCode = [
    `await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});`,
    'const pick = (k) => (process.env[k] === undefined ? null : process.env[k]);',
    "const report = { DATABASE_URL: pick('DATABASE_URL'), TEST_DATABASE_URL: pick('TEST_DATABASE_URL'),",
    "  WTDG_LOCAL_SENTINEL: pick('WTDG_LOCAL_SENTINEL'), WTDG_DOTENV_SENTINEL: pick('WTDG_DOTENV_SENTINEL') };",
    "process.stdout.write('WTDG_RESULT ' + JSON.stringify(report) + '\\n');",
  ].join('\n');

  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER_URL, '--input-type=module', '-e', childCode],
    { cwd: fakeCwd, env: bareChildEnv(extraEnv), encoding: 'utf8', timeout: 60_000 },
  );
  const line = (result.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('WTDG_RESULT '));
  if (result.status !== 0 || !line) {
    throw new Error(
      `child loadEnvFirst run failed (status ${result.status}): ${String(result.stderr ?? '').slice(0, 2000)}`,
    );
  }
  return JSON.parse(line.slice('WTDG_RESULT '.length)) as ChildEnvReport;
}

describe('TEST-DB-GUARD: loadEnvFirst in a test runtime (NODE_ENV=test, own process, fake cwd)', () => {
  it('keeps an explicitly set DATABASE_URL and TEST_DATABASE_URL and never reads the fake .env.local', () => {
    const report = runLoadEnvFirstInChild({
      NODE_ENV: 'test',
      DATABASE_URL: EXPLICIT_DEAD_DATABASE_URL,
      TEST_DATABASE_URL: EXPLICIT_DEAD_TEST_DATABASE_URL,
    });

    expect(report.DATABASE_URL).toBe(EXPLICIT_DEAD_DATABASE_URL);
    expect(report.TEST_DATABASE_URL).toBe(EXPLICIT_DEAD_TEST_DATABASE_URL);
    expect(report.WTDG_LOCAL_SENTINEL).toBeNull();
  });

  it('does not fill an unset DATABASE_URL from the fake .env.local', () => {
    const report = runLoadEnvFirstInChild({ NODE_ENV: 'test' });

    expect(report.DATABASE_URL).toBeNull();
    expect(report.WTDG_LOCAL_SENTINEL).toBeNull();
  });

  it('takes no database connection setting from another env file (.env), but still loads its other keys', () => {
    const report = runLoadEnvFirstInChild({ NODE_ENV: 'test' });

    expect(report.TEST_DATABASE_URL).toBeNull();
    expect(report.WTDG_DOTENV_SENTINEL).toBe('loaded-from-the-fake-env');
  });

  it('treats a Vitest worker as a test runtime even when the test itself set NODE_ENV=production', () => {
    const report = runLoadEnvFirstInChild({
      NODE_ENV: 'production',
      VITEST: 'true',
      DATABASE_URL: EXPLICIT_DEAD_DATABASE_URL,
    });

    expect(report.DATABASE_URL).toBe(EXPLICIT_DEAD_DATABASE_URL);
    expect(report.WTDG_LOCAL_SENTINEL).toBeNull();
  });
});

describe('TEST-DB-GUARD: loadEnvFirst outside a test runtime is unchanged (dev/staging/prod)', () => {
  it.each([['(unset)'], ['development'], ['production']])(
    'NODE_ENV=%s: deletes the inherited DATABASE_URL and loads .env.local over it, as before',
    (nodeEnv) => {
      const report = runLoadEnvFirstInChild({
        ...(nodeEnv === '(unset)' ? {} : { NODE_ENV: nodeEnv }),
        DATABASE_URL: EXPLICIT_DEAD_DATABASE_URL,
      });

      expect(report.DATABASE_URL).toBe(FAKE_LOCAL_DATABASE_URL);
      expect(report.WTDG_LOCAL_SENTINEL).toBe('loaded-from-the-fake-env-local');
      // .env is loaded first and is not overridden by .env.local only where .env.local is silent.
      expect(report.WTDG_DOTENV_SENTINEL).toBe('loaded-from-the-fake-env');
      expect(report.TEST_DATABASE_URL).toBe(FAKE_LOCAL_DATABASE_URL);
    },
  );
});
