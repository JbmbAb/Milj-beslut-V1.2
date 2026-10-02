// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 (owner decision 2026-10-03 (4) point 8): a test never inherits ANY
 * live, mutable data root -- TDG-3 removed only the CAS keys. QUARANTINE_ROOT, MASTER_ARCHIVE_ROOT,
 * OUTLOOK_* ... set in the caller's shell went as they were to every Vitest worker, every process a
 * test starts and the Playwright runner and servers; and removing a key is not enough when its
 * unset default is a location (ADMIN_ROLE_GRANT_CAS_ROOT -> `.data/admin-role-grants` under cwd,
 * which TDG-3 itself caused by removing it).
 *
 * The shell values below are strings only: nothing reads, stats or creates them. The behavioural
 * cases use only the real setup file, the real playwright.config.ts, the real loadEnv and dotenv --
 * so on the code before TDG-4 they fail on the leak itself, not on a missing module.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const SETUP_URL = pathToFileURL(path.join(REPO_ROOT, 'tests/setup/testDatabaseGuard.ts')).href;
const LOAD_ENV_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnv.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const ISOLATION_MODULE = '../../server/modules/test-db-guard/testDataRootIsolation';

const DEMO = 'D:\\mimer-demo';
/** The owner's examples: the live roots a shell or a demo start script may carry. */
const SHELL_DATA_ROOTS = {
  QUARANTINE_ROOT: `${DEMO}\\quarantine`,
  MASTER_ARCHIVE_ROOT: `${DEMO}\\master-archive`,
  GEO_MASTER_ARCHIVE: `${DEMO}\\geo-master-archive`,
  H_DRIVE_ROOT: `${DEMO}\\h-drive`,
  OUTLOOK_BASE_DIR: `${DEMO}\\outlook`,
  OUTLOOK_STORAGE_ROOT: `${DEMO}\\outlook-attachments`,
  IMPORT_ARCHIVE_ROOT: `${DEMO}\\import-archive`,
  IMPORT_SOURCE_ROOT: `${DEMO}\\downloads`,
  KNOWLEDGE_BASE_ROOT: `${DEMO}\\knowledge-base`,
  ARCHIVE_SHADOW_ROOT: `${DEMO}\\archive-shadow`,
  BACKUP_DIR: `${DEMO}\\backups`,
  ADMIN_ROLE_GRANT_CAS_ROOT: `${DEMO}\\admin-role-grants`,
  LOCAL_DB_ROOT: `${DEMO}\\local-db`,
  OPS_PIPELINE_ROOT: `${DEMO}\\ops-pipeline`,
  MIMERS_ROOT: `${DEMO}\\cas`,
};
/** Their unset default is a location (cwd-relative or an absolute live path): a fresh temp root instead. */
const LOCATION_DEFAULT_KEYS = [
  'ADMIN_ROLE_GRANT_CAS_ROOT',
  'ARCHIVE_SHADOW_ROOT',
  'BACKUP_DIR',
  'GEO_MASTER_ARCHIVE',
  'H_DRIVE_ROOT',
  'IMPORT_ARCHIVE_ROOT',
  'IMPORT_SOURCE_ROOT',
  'KNOWLEDGE_BASE_ROOT',
  'MASTER_ARCHIVE_ROOT',
  'OUTLOOK_BASE_DIR',
  'OUTLOOK_STORAGE_ROOT',
  'QUARANTINE_ROOT',
];
/** Unset means no location (off / fails closed): removed, left unset. */
const NO_LOCATION_KEYS = ['LOCAL_DB_ROOT', 'MIMERS_ROOT', 'OPS_PIPELINE_ROOT'];

const OPT_IN = {
  PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/wtdg4_roots_test',
  MIMER_TEST_DB_ALLOW: 'wtdg4_roots_test',
};

let fakeCwd: string;
let tmpRoot: string;

beforeAll(() => {
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg4-roots-cwd-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg4-roots-tmp-'));
  // An env file naming the demo roots: a test runtime must not take them from a file either.
  fs.writeFileSync(
    path.join(fakeCwd, '.env'),
    `QUARANTINE_ROOT=${DEMO}\\from-env-file\nMIMERS_ROOT=${DEMO}\\from-env-file\nWTDG4_PLAIN=kept\n`,
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(fakeCwd, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function bareEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'HOME', 'USERPROFILE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot, ...extra };
}

function runChild(code: string, env: NodeJS.ProcessEnv): unknown {
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
  const line = String(result.stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('WTDG4_RESULT '));
  if (!line) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
  return JSON.parse(line.slice('WTDG4_RESULT '.length));
}

const pick = (env: Record<string, string | undefined> | null, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => env?.[k] !== undefined).map((k) => [k, env?.[k] as string]));
const mentionsDemo = (env: Record<string, string | undefined> | null) =>
  Object.entries(env ?? {})
    .filter(([, value]) => String(value).toLowerCase().includes('mimer-demo'))
    .map(([key]) => key);
const isInside = (child: string, parent: string) =>
  path
    .resolve(child)
    .toLowerCase()
    .startsWith(path.resolve(parent).toLowerCase() + path.sep);

function expectFreshRoots(
  env: Record<string, string | undefined> | null,
  tmp: string,
  keys: readonly string[] = LOCATION_DEFAULT_KEYS,
): string {
  const roots = pick(env, keys);
  expect(Object.keys(roots).sort()).toEqual([...keys].sort());
  const runDirs = new Set<string>();
  for (const [key, value] of Object.entries(roots)) {
    expect({ key, absolute: path.isAbsolute(value), inTemp: isInside(value, tmp) }).toEqual({
      key,
      absolute: true,
      inTemp: true,
    });
    runDirs.add(path.dirname(value));
  }
  // One run directory per scrub, created by it (and the per-key directories are not pre-created).
  expect(runDirs.size).toBe(1);
  const [runDir] = [...runDirs];
  expect(path.basename(runDir)).toMatch(/^miljobeslut-test-data-/);
  return runDir;
}

describe('Vitest: no data root of the shell reaches a worker or any process a test starts', () => {
  it('this worker: every location-default key points into a fresh temp run directory of this file', () => {
    const runDir = expectFreshRoots(process.env, os.tmpdir());
    expect(fs.statSync(runDir).isDirectory()).toBe(true);
    expect(mentionsDemo(process.env)).toEqual([]);
  });

  it('the setup file scrubs a shell full of demo roots: worker, child and grandchild see only the fresh roots', () => {
    const report = runChild(
      `
await import(${JSON.stringify(SETUP_URL)});
const { spawnSync } = await import('node:child_process');
const keys = ${JSON.stringify([...LOCATION_DEFAULT_KEYS, ...NO_LOCATION_KEYS])};
const grandchild = "const { spawnSync } = require('node:child_process');" +
  "const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { encoding: 'utf8' });" +
  "process.stdout.write(r.stdout)";
const child = spawnSync(process.execPath, ['-e', grandchild], { encoding: 'utf8' });
const pick = (env) => Object.fromEntries(keys.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
process.stdout.write('WTDG4_RESULT ' + JSON.stringify({ worker: pick(process.env), grandchild: pick(JSON.parse(child.stdout || '{}')) }) + String.fromCharCode(10));
process.exit(0);
`,
      bareEnv({ ...SHELL_DATA_ROOTS, DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none' }),
    ) as { worker: Record<string, string>; grandchild: Record<string, string> };
    expect(mentionsDemo(report.worker)).toEqual([]);
    expect(mentionsDemo(report.grandchild)).toEqual([]);
    expectFreshRoots(report.worker, tmpRoot);
    // The processes a test starts inherit exactly the worker's fresh roots.
    expect(report.grandchild).toEqual(report.worker);
    for (const key of NO_LOCATION_KEYS)
      expect({ key, value: report.worker[key] }).toEqual({ key, value: undefined });
  });

  it('an env file cannot refill a scrubbed data root in a test runtime (loadEnv and dotenv)', async () => {
    const saved = { QUARANTINE_ROOT: process.env.QUARANTINE_ROOT, MIMERS_ROOT: process.env.MIMERS_ROOT };
    delete process.env.QUARANTINE_ROOT;
    delete process.env.MIMERS_ROOT;
    delete process.env.WTDG4_PLAIN;
    try {
      const { loadEnvFile } = (await import(LOAD_ENV_URL)) as { loadEnvFile: (file: string) => void };
      loadEnvFile(path.join(fakeCwd, '.env'));
      expect(pick(process.env, ['QUARANTINE_ROOT', 'MIMERS_ROOT', 'WTDG4_PLAIN'])).toEqual({
        WTDG4_PLAIN: 'kept',
      });
      delete process.env.WTDG4_PLAIN;
      const dotenv = createRequire(import.meta.url)('dotenv') as { config: (o: { path: string }) => unknown };
      dotenv.config({ path: path.join(fakeCwd, '.env') });
      expect(pick(process.env, ['QUARANTINE_ROOT', 'MIMERS_ROOT', 'WTDG4_PLAIN'])).toEqual({
        WTDG4_PLAIN: 'kept',
      });
    } finally {
      delete process.env.WTDG4_PLAIN;
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

type ServerEnvs = {
  error: string | null;
  runner: Record<string, string>;
  api: Record<string, string> | null;
  ui: Record<string, string> | null;
};

function loadConfig(extra: Record<string, string>): ServerEnvs {
  return runChild(
    `
const report = { error: null, runner: {}, api: null, ui: null };
try {
  const cfg = (await import(${JSON.stringify(CONFIG_URL)})).default;
  const servers = Array.isArray(cfg.webServer) ? cfg.webServer : cfg.webServer ? [cfg.webServer] : [];
  if (servers[0]) report.api = { ...process.env, ...servers[0].env };
  if (servers[1]) report.ui = { ...process.env, ...servers[1].env };
} catch (e) {
  report.error = String(e && e.message);
}
report.runner = { ...process.env };
process.stdout.write('WTDG4_RESULT ' + JSON.stringify(report) + String.fromCharCode(10));
process.exit(0);
`,
    bareEnv(extra),
  ) as ServerEnvs;
}

describe('playwright.config.ts: no data root of the shell reaches the runner, the workers or the servers', () => {
  it('local run: runner and workers keep none; both servers get one fresh temp run directory', () => {
    const r = loadConfig({ ...OPT_IN, ...SHELL_DATA_ROOTS });
    expect(r.error).toBeNull();
    expect(pick(r.runner, Object.keys(SHELL_DATA_ROOTS))).toEqual({});
    expect(mentionsDemo(r.runner)).toEqual([]);
    for (const env of [r.api, r.ui]) {
      expect(mentionsDemo(env)).toEqual([]);
      // ADMIN_ROLE_GRANT_CAS_ROOT (and MIMERS_ROOT) are the existing fresh CAS dirs of TDG-3.
      expectFreshRoots(
        env,
        tmpRoot,
        LOCATION_DEFAULT_KEYS.filter((key) => key !== 'ADMIN_ROLE_GRANT_CAS_ROOT'),
      );
      expect(isInside(String(env?.ADMIN_ROLE_GRANT_CAS_ROOT), tmpRoot)).toBe(true);
      expect(pick(env, ['LOCAL_DB_ROOT', 'OPS_PIPELINE_ROOT'])).toEqual({});
    }
    expect(r.api?.QUARANTINE_ROOT).toBe(r.ui?.QUARANTINE_ROOT);
  });

  it('every run gets its own run directory', () => {
    const a = loadConfig(OPT_IN);
    const b = loadConfig(OPT_IN);
    expect(a.api?.QUARANTINE_ROOT).toBeTruthy();
    expect(path.dirname(String(a.api?.QUARANTINE_ROOT))).not.toBe(
      path.dirname(String(b.api?.QUARANTINE_ROOT)),
    );
  });

  it('external run: no server, and the runner and workers still keep no data root of the shell', () => {
    const r = loadConfig({ PLAYWRIGHT_BASE_URL: 'https://203.0.113.10', ...SHELL_DATA_ROOTS });
    expect(r.error).toBeNull();
    expect(r.api).toBeNull();
    expect(pick(r.runner, Object.keys(SHELL_DATA_ROOTS))).toEqual({});
  });
});

describe('the declarative list (server/modules/test-db-guard/testDataRootIsolation.ts)', () => {
  it('one entry per key, upper case, a handling and a reason; TDG-3 CAS keys stay removed', async () => {
    const { TEST_DATA_ROOT_ENV } = await import(ISOLATION_MODULE);
    const keys = TEST_DATA_ROOT_ENV.map((e: { key: string }) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of TEST_DATA_ROOT_ENV as Array<{ key: string; handling: string; why: string }>) {
      expect(entry.key).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(['fresh-temp-root', 'removed']).toContain(entry.handling);
      expect(entry.why.length).toBeGreaterThan(10);
    }
    for (const key of LOCATION_DEFAULT_KEYS) {
      expect({
        key,
        handling: TEST_DATA_ROOT_ENV.find((e: { key: string }) => e.key === key)?.handling,
      }).toEqual({
        key,
        handling: 'fresh-temp-root',
      });
    }
    for (const key of NO_LOCATION_KEYS) {
      expect({
        key,
        handling: TEST_DATA_ROOT_ENV.find((e: { key: string }) => e.key === key)?.handling,
      }).toEqual({
        key,
        handling: 'removed',
      });
    }
  });

  it('isolate: removes every listed and every CAS key, keeps the rest, and assigns a new run directory per call', async () => {
    const { isolateTestDataRootEnv, TEST_DATA_ROOT_ENV, testDataRootEnvHandling } = await import(
      ISOLATION_MODULE
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg4-isolate-'));
    try {
      const shell: NodeJS.ProcessEnv = {};
      for (const entry of TEST_DATA_ROOT_ENV as Array<{ key: string }>)
        shell[entry.key] = `${DEMO}\\${entry.key}`;
      const env: NodeJS.ProcessEnv = {
        ...shell,
        SOME_OTHER_CAS: 'x',
        MIMERS_NEW_SETTING: 'y',
        PATH: 'p',
        CASE_ID: 'c',
      };
      const a = isolateTestDataRootEnv(env, 'wtdg4 test', { tmp });
      expect(a.removed).toEqual([...Object.keys(shell), 'MIMERS_NEW_SETTING', 'SOME_OTHER_CAS'].sort());
      expect(env.PATH).toBe('p');
      expect(env.CASE_ID).toBe('c');
      expect(mentionsDemo(env as Record<string, string>)).toEqual([]);
      const freshKeys = (TEST_DATA_ROOT_ENV as Array<{ key: string; handling: string }>)
        .filter((e) => e.handling === 'fresh-temp-root')
        .map((e) => e.key)
        .sort();
      expect(Object.keys(a.assigned).sort()).toEqual(freshKeys);
      expect(path.dirname(String(a.runRoot))).toBe(path.resolve(tmp));
      expect(fs.readdirSync(String(a.runRoot))).toEqual([]);
      for (const key of freshKeys) expect(path.dirname(String(env[key]))).toBe(a.runRoot);
      for (const key of Object.keys(env)) {
        if (testDataRootEnvHandling(key) === 'removed') throw new Error(`removed key still set: ${key}`);
      }
      const b = isolateTestDataRootEnv(env, 'wtdg4 test', { tmp });
      expect(b.runRoot).not.toBe(a.runRoot);
      const c = isolateTestDataRootEnv(env, 'wtdg4 test', { tmp, assignFreshRoots: false });
      expect(c.runRoot).toBeNull();
      expect(Object.keys(env).filter((key) => testDataRootEnvHandling(key) !== null)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
