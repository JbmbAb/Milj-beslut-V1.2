// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertExternalE2eTargetsAreRemote,
  LOCAL_E2E_DEFAULT_API_PORT,
  resolveLocalE2eServerPlan,
} from '../../server/modules/test-db-guard/localE2eServerPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5): a local Playwright run can never start or reuse a server on a database
 * that is not an opted-in disposable *_test database.
 *
 * The REAL playwright.config.ts is evaluated in its own process (env built from scratch, cwd = a
 * temp dir holding FAKE .env, .env.local, .env.test and .env.test.local with fabricated `.invalid`
 * values), and the API server's env loading is then replayed exactly as Playwright starts it:
 * `{ ...process.env, ...webServer.env }` (playwright/lib/runner) in a second process that runs the
 * REAL server/loadEnvFirst.ts in the same fake cwd. Nothing is started, nothing listens, nothing
 * connects: the config is only loaded and loadEnvFirst only reports what ended up in its env.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const DOTENV_CONFIG_URL = pathToFileURL(createRequire(import.meta.url).resolve('dotenv/config')).href;

const FAKE_URL = (where: string) =>
  `postgresql://wtdg2-fabricated:wtdg2-not-a-password@wtdg2-fake-${where}.invalid:1/wtdg2_fake_${where}`;
const OPTED_IN_URL = 'postgresql://u:p@127.0.0.1:5433/wtdg2_e2e_test';
const OPT_IN = { PLAYWRIGHT_DATABASE_URL: OPTED_IN_URL, MIMER_TEST_DB_ALLOW: 'wtdg2_e2e_test' };

const REPORTED_KEYS = [
  'NODE_ENV',
  'MIMER_TEST_MODE',
  'DATABASE_URL',
  'PLAYWRIGHT_DATABASE_URL',
  'MIMER_TEST_DB_ALLOW',
  'PLAYWRIGHT_API_BASE_URL',
  'JWT_ACCESS_SECRET',
  'GEMINI_API_KEY',
  'WTDG2_LOCAL_SENTINEL',
  'WTDG2_DOTENV_SENTINEL',
  'WTDG2_TEST_SENTINEL',
];

type WebServerReport = {
  command: string;
  port: number;
  reuseExistingServer: unknown;
  env: Record<string, string | null>;
};
type ConfigReport = {
  ok: boolean;
  error: string | null;
  webServer: WebServerReport[];
  runnerEnv: Record<string, string | null>;
  apiServerSpawnEnv: Record<string, string> | null;
};

let fakeCwd: string;
let tmpRoot: string;

beforeAll(() => {
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg2-playwright-cwd-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg2-playwright-tmp-'));
  const write = (name: string, lines: string[]) =>
    fs.writeFileSync(path.join(fakeCwd, name), lines.join('\n'), 'utf8');
  write('.env.local', [
    `DATABASE_URL=${FAKE_URL('local')}`,
    'MIMER_TEST_DB_ALLOW=wtdg2_fake_local',
    'GEMINI_API_KEY=wtdg2-fake-gemini-from-env-local',
    'WTDG2_LOCAL_SENTINEL=loaded-from-the-fake-env-local',
  ]);
  write('.env', [`DATABASE_URL=${FAKE_URL('dotenv')}`, 'WTDG2_DOTENV_SENTINEL=loaded-from-the-fake-env']);
  write('.env.test', [
    `DATABASE_URL=${FAKE_URL('envtest')}`,
    'JWT_ACCESS_SECRET=wtdg2-fake-jwt-from-env-test',
    'WTDG2_TEST_SENTINEL=loaded-from-the-fake-env-test',
  ]);
  write('.env.test.local', [`DATABASE_URL=${FAKE_URL('envtestlocal')}`]);
});

afterAll(() => {
  fs.rmSync(fakeCwd, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Only what Node, tsx and the OS need; temp files of the config land in this test's own dir. */
function bareEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'HOME', 'USERPROFILE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot, ...extra };
}

function runChild(code: string, env: NodeJS.ProcessEnv): string {
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER_URL, '--input-type=module', '-e', code],
    {
      cwd: fakeCwd,
      env,
      encoding: 'utf8',
      timeout: 90_000,
    },
  );
  const out = String(result.stdout ?? '');
  const at = out.indexOf('WTDG2_RESULT ');
  if (at < 0) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
  return out.slice(at + 'WTDG2_RESULT '.length).split(/\r?\n/)[0];
}

function loadConfigInChild(extra: Record<string, string>): ConfigReport {
  const childCode = `
const KEYS = ${JSON.stringify(REPORTED_KEYS)};
const pick = (e) => (e ? Object.fromEntries(KEYS.map((k) => [k, e[k] === undefined ? null : e[k]])) : {});
const report = { ok: false, error: null, webServer: [], runnerEnv: {}, apiServerSpawnEnv: null };
try {
  const cfg = (await import(${JSON.stringify(CONFIG_URL)})).default;
  const servers = Array.isArray(cfg.webServer) ? cfg.webServer : cfg.webServer ? [cfg.webServer] : [];
  report.ok = true;
  report.webServer = servers.map((w) => ({
    command: w.command, port: w.port, reuseExistingServer: w.reuseExistingServer, env: pick(w.env),
  }));
  report.runnerEnv = pick(process.env);
  // Exactly what Playwright hands the API server process: { ...process.env, ...webServer.env }.
  if (servers[0]) report.apiServerSpawnEnv = { ...process.env, ...servers[0].env };
} catch (e) {
  report.error = String(e && e.message);
}
process.stdout.write('WTDG2_RESULT ' + JSON.stringify(report) + String.fromCharCode(10));
process.exit(0);
`;
  return JSON.parse(runChild(childCode, bareEnv(extra))) as ConfigReport;
}

/**
 * Replays the API server's env loading: server/index.ts imports loadEnvFirst first, and further
 * down its import graph server/services/importPathService.ts does `import 'dotenv/config'`.
 */
function apiServerEnvAfterLoadEnvFirst(spawnEnv: Record<string, string>): Record<string, string | null> {
  const childCode = `
await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});
await import(${JSON.stringify(DOTENV_CONFIG_URL)});
const KEYS = ${JSON.stringify(REPORTED_KEYS)};
const report = Object.fromEntries(KEYS.map((k) => [k, process.env[k] === undefined ? null : process.env[k]]));
process.stdout.write('WTDG2_RESULT ' + JSON.stringify(report) + String.fromCharCode(10));
process.exit(0);
`;
  return JSON.parse(runChild(childCode, spawnEnv)) as Record<string, string | null>;
}

describe('TEST-DB-GUARD: playwright.config.ts refuses every local run without an opted-in *_test database', () => {
  it('refuses the live database', () => {
    const r = loadConfigInChild({ PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/miljobeslut' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD.*playwright\.config\.ts/);
  });

  it('refuses the prescribed dead URL without an opt-in (E2E writes through its server)', () => {
    const r = loadConfigInChild({ DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD.*opted-in/);
  });

  it('refuses when the process environment names no database, whatever the env files in cwd say', () => {
    const r = loadConfigInChild({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD.*not set in the process environment/);
  });

  it('refuses a ?port= override onto the live port 5432 (pg connects there), even opted in', () => {
    const r = loadConfigInChild({
      PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/wtdg2_e2e_test?port=5432',
      MIMER_TEST_DB_ALLOW: 'wtdg2_e2e_test',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD.*live database port/);
  });

  it('refuses the live port 5432 even when opted in', () => {
    const r = loadConfigInChild({
      PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@localhost:5432/wtdg2_e2e_test',
      MIMER_TEST_DB_ALLOW: 'wtdg2_e2e_test',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD/);
  });

  it.each([
    ['PLAYWRIGHT_LOCAL_API_PORT', '8787'],
    ['PLAYWRIGHT_LOCAL_UI_PORT', '5173'],
    ['PLAYWRIGHT_LOCAL_API_PORT', '3000'],
  ])('refuses %s=%s (a port of the running demonstrator), even opted in', (key, port) => {
    const r = loadConfigInChild({ ...OPT_IN, [key]: port });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(new RegExp(`TEST-DB-GUARD.*port ${port}`));
  });
});

describe('TEST-DB-GUARD: an admitted local run gets fresh servers that keep the checked database', () => {
  it('never reuses a server and never uses 8787, even with PLAYWRIGHT_FORCE_FRESH_SERVER=false', () => {
    const r = loadConfigInChild({ ...OPT_IN, PLAYWRIGHT_FORCE_FRESH_SERVER: 'false' });
    expect(r.error).toBeNull();
    expect(r.webServer).toHaveLength(2);
    for (const server of r.webServer) expect(server.reuseExistingServer).toBe(false);
    expect(r.webServer[0].port).toBe(LOCAL_E2E_DEFAULT_API_PORT);
    expect(r.webServer.map((s) => s.port)).not.toContain(8787);
  });

  it('hands the API server the checked URL, the opt-in and the MIMER_TEST_MODE marker, and nothing from env files', () => {
    const r = loadConfigInChild(OPT_IN);
    expect(r.webServer[0].env).toMatchObject({
      MIMER_TEST_MODE: '1',
      DATABASE_URL: OPTED_IN_URL,
      MIMER_TEST_DB_ALLOW: 'wtdg2_e2e_test',
      JWT_ACCESS_SECRET: 'test-access-secret',
    });
    expect(r.webServer[0].env.GEMINI_API_KEY).toBeNull();
    expect(r.runnerEnv).toMatchObject({
      MIMER_TEST_MODE: '1',
      DATABASE_URL: OPTED_IN_URL,
      PLAYWRIGHT_DATABASE_URL: OPTED_IN_URL,
      PLAYWRIGHT_API_BASE_URL: `http://127.0.0.1:${LOCAL_E2E_DEFAULT_API_PORT}`,
    });
  });

  it('the API server, started the way Playwright starts it, keeps the URL and reads neither .env nor .env.local', () => {
    const r = loadConfigInChild(OPT_IN);
    expect(r.apiServerSpawnEnv).not.toBeNull();
    const server = apiServerEnvAfterLoadEnvFirst(r.apiServerSpawnEnv as Record<string, string>);
    expect(server).toMatchObject({
      DATABASE_URL: OPTED_IN_URL,
      MIMER_TEST_DB_ALLOW: 'wtdg2_e2e_test',
      WTDG2_LOCAL_SENTINEL: null,
      WTDG2_DOTENV_SENTINEL: null,
      WTDG2_TEST_SENTINEL: null,
      GEMINI_API_KEY: null,
    });
  });
});

describe('TEST-DB-GUARD: an external target never points at this workstation', () => {
  it('does not apply the local rules to a remote target (staging smoke)', () => {
    const r = loadConfigInChild({ PLAYWRIGHT_BASE_URL: 'https://wtdg2-external.invalid' });
    expect(r).toMatchObject({ ok: true, error: null, webServer: [] });
  });

  it.each([
    ['PLAYWRIGHT_BASE_URL', 'http://127.0.0.1:8787'],
    ['STAGING_URL', 'http://localhost:5173'],
    ['PLAYWRIGHT_BASE_URL', 'http://[::1]:3200'],
  ])('refuses %s=%s (it would reuse a running local server)', (key, url) => {
    const r = loadConfigInChild({ [key]: url });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD.*this workstation/);
  });

  it('refuses a local PLAYWRIGHT_API_BASE_URL next to a remote external target', () => {
    const r = loadConfigInChild({
      PLAYWRIGHT_BASE_URL: 'https://wtdg2-external.invalid',
      PLAYWRIGHT_API_BASE_URL: 'http://localhost:8787',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TEST-DB-GUARD.*PLAYWRIGHT_API_BASE_URL/);
  });
});

describe('TEST-DB-GUARD: the local E2E policy itself (pure)', () => {
  it('admits only an opted-in *_test database and defaults to fresh ports of its own', () => {
    expect(resolveLocalE2eServerPlan(OPT_IN)).toEqual({
      apiPort: LOCAL_E2E_DEFAULT_API_PORT,
      uiPort: 3200,
      databaseUrl: OPTED_IN_URL,
      databaseOptIn: 'wtdg2_e2e_test',
    });
    expect(() => resolveLocalE2eServerPlan({ DATABASE_URL: 'postgresql://x:x@wtdg2.invalid:1/x' })).toThrow(
      /opted-in/,
    );
    expect(() =>
      resolveLocalE2eServerPlan({ ...OPT_IN, PLAYWRIGHT_DATABASE_URL: 'prisma://wtdg2.invalid/?api_key=x' }),
    ).toThrow(/remote managed/);
    expect(() => resolveLocalE2eServerPlan({ ...OPT_IN, PLAYWRIGHT_LOCAL_API_PORT: 'x8787' })).toThrow(
      /not a TCP port/,
    );
    expect(() =>
      resolveLocalE2eServerPlan({
        ...OPT_IN,
        PLAYWRIGHT_LOCAL_API_PORT: '4000',
        PLAYWRIGHT_LOCAL_UI_PORT: '4000',
      }),
    ).toThrow(/share port/);
  });

  it('external targets: workstation hosts are refused, remote ones pass', () => {
    expect(() => assertExternalE2eTargetsAreRemote({ STAGING_API_BASE_URL: 'http://0.0.0.0:8787' })).toThrow(
      /this workstation/,
    );
    expect(() => assertExternalE2eTargetsAreRemote({ STAGING_URL: 'https://wtdg2.invalid' })).not.toThrow();
  });
});
