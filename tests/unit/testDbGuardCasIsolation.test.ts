// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFreshTestCasRoots,
  isCasEnvKey,
  removeInheritedCasEnv,
} from '../../server/modules/test-db-guard/testCasIsolation';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-3 (MIMERS_ROOT; owner principle: tests never touch live data): a
 * MIMERS_ROOT set in the caller's shell went as it was to the E2E API server, which could then
 * write into the demonstrator's CAS (D:\mimer-demo\cas). Now no test process inherits a CAS
 * setting from the shell: the E2E servers get a FRESH temp CAS root created by the run, and the
 * Vitest setup removes CAS settings from every worker, so no process a test starts inherits them.
 *
 * The shell values below are only strings: nothing here reads, stats or creates them. The REAL
 * playwright.config.ts is evaluated in a child process (cwd and TEMP are this test's own temp
 * dirs); the servers' env is replayed exactly as Playwright builds it,
 * `{ ...process.env, ...webServer.env }`. Nothing is started, nothing connects.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const SETUP_URL = pathToFileURL(path.join(REPO_ROOT, 'tests/setup/testDatabaseGuard.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const DEMO_CAS = 'D:\\mimer-demo\\cas';
const SHELL_CAS_ENV = {
  MIMERS_ROOT: DEMO_CAS,
  MIMERS_NFS_ROOT: 'D:\\mimer-demo\\nfs',
  MIMERS_DURABILITY_MODE: 'none',
  MIMERS_REQUIRED: 'true',
  LU_MPS_CAS: 'memory',
  ADMIN_ROLE_GRANT_CAS_ROOT: 'D:\\mimer-demo\\admin-role-grants',
};
const OPT_IN = {
  PLAYWRIGHT_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/wtdg3_cas_test',
  MIMER_TEST_DB_ALLOW: 'wtdg3_cas_test',
};

describe('which settings are CAS settings', () => {
  it('every MIMERS_* key and every key naming a CAS; the guard markers and look-alikes are not', () => {
    for (const key of [
      'MIMERS_ROOT',
      'mimers_root',
      'MIMERS_NFS_ROOT',
      'MIMERS_DURABILITY_MODE',
      'LU_MPS_CAS',
      'ADMIN_ROLE_GRANT_CAS_ROOT',
      'CAS',
    ]) {
      expect({ key, cas: isCasEnvKey(key) }).toEqual({ key, cas: true });
    }
    for (const key of [
      'MIMER_TEST_MODE',
      'MIMER_TEST_DB_ALLOW',
      'CASE_ID',
      'CASCADE',
      'PATH',
      'DATABASE_URL',
    ]) {
      expect({ key, cas: isCasEnvKey(key) }).toEqual({ key, cas: false });
    }
  });

  it('removeInheritedCasEnv removes exactly those and returns their names', () => {
    const env: NodeJS.ProcessEnv = { ...SHELL_CAS_ENV, MIMER_TEST_MODE: '1', PATH: 'p' };
    expect(removeInheritedCasEnv(env)).toEqual(Object.keys(SHELL_CAS_ENV).sort());
    expect(env).toEqual({ MIMER_TEST_MODE: '1', PATH: 'p' });
  });

  it('a fresh root is new, empty, absolute and in the temp directory on every call', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg3-cas-roots-'));
    try {
      const a = createFreshTestCasRoots(tmp);
      const b = createFreshTestCasRoots(tmp);
      expect(a.runRoot).not.toBe(b.runRoot);
      for (const dir of [a.mimersRoot, a.adminRoleGrantCasRoot]) {
        expect(path.isAbsolute(dir)).toBe(true);
        expect(dir.startsWith(path.join(tmp, 'miljobeslut-e2e-cas-'))).toBe(true);
        expect(fs.readdirSync(dir)).toEqual([]);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

let fakeCwd: string;
let tmpRoot: string;

beforeAll(() => {
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg3-cas-cwd-'));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg3-cas-tmp-'));
  // A fake env file naming the demo CAS: a hermetic server must not read it either.
  fs.writeFileSync(path.join(fakeCwd, '.env'), `MIMERS_ROOT=${DEMO_CAS}\\from-env-file\n`, 'utf8');
  fs.writeFileSync(path.join(fakeCwd, '.env.local'), `MIMERS_ROOT=${DEMO_CAS}\\from-env-local\n`, 'utf8');
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
    .find((l) => l.startsWith('WTDG3_RESULT '));
  if (!line) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
  return JSON.parse(line.slice('WTDG3_RESULT '.length));
}

type ServerEnvs = {
  error: string | null;
  runner: Record<string, string>;
  api: Record<string, string> | null;
  ui: Record<string, string> | null;
};

/** The REAL config; each server's env exactly as Playwright spawns it. */
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
process.stdout.write('WTDG3_RESULT ' + JSON.stringify(report) + String.fromCharCode(10));
process.exit(0);
`,
    bareEnv(extra),
  ) as ServerEnvs;
}

const casKeysOf = (env: Record<string, string> | null) =>
  Object.fromEntries(Object.entries(env ?? {}).filter(([key]) => isCasEnvKey(key)));
const mentionsDemo = (env: Record<string, string> | null) =>
  Object.entries(env ?? {}).filter(([, value]) => String(value).toLowerCase().includes('mimer-demo'));

describe('playwright.config.ts: a shell CAS never reaches the E2E servers, workers or runner', () => {
  it('MIMERS_ROOT=D:\\mimer-demo\\cas in the shell: the API server gets a fresh temp CAS of this run', () => {
    const r = loadConfig({ ...OPT_IN, ...SHELL_CAS_ENV });
    expect(r.error).toBeNull();
    for (const env of [r.api, r.ui]) {
      expect(mentionsDemo(env)).toEqual([]);
      const cas = casKeysOf(env);
      expect(Object.keys(cas).sort()).toEqual(['ADMIN_ROLE_GRANT_CAS_ROOT', 'MIMERS_ROOT']);
      for (const dir of [cas.MIMERS_ROOT, cas.ADMIN_ROLE_GRANT_CAS_ROOT]) {
        expect(path.isAbsolute(dir)).toBe(true);
        expect(path.resolve(dir).startsWith(path.resolve(tmpRoot) + path.sep)).toBe(true);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
        expect(fs.readdirSync(dir)).toEqual([]);
      }
    }
    // The runner and every worker (they load this config too) keep no CAS setting at all.
    expect(casKeysOf(r.runner)).toEqual({});
    expect(mentionsDemo(r.runner)).toEqual([]);
  });

  it('every run gets its own root, never a reused one', () => {
    const a = loadConfig(OPT_IN);
    const b = loadConfig(OPT_IN);
    expect(a.api?.MIMERS_ROOT).toBeTruthy();
    expect(a.api?.MIMERS_ROOT).not.toBe(b.api?.MIMERS_ROOT);
  });

  it('the API server, started the way Playwright starts it, keeps the fresh root and reads no env file naming the demo CAS', () => {
    const r = loadConfig({ ...OPT_IN, ...SHELL_CAS_ENV });
    const server = runChild(
      `
await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});
process.stdout.write('WTDG3_RESULT ' + JSON.stringify({ MIMERS_ROOT: process.env.MIMERS_ROOT ?? null }) + String.fromCharCode(10));
process.exit(0);
`,
      r.api as NodeJS.ProcessEnv,
    ) as { MIMERS_ROOT: string | null };
    expect(server.MIMERS_ROOT).toBe(r.api?.MIMERS_ROOT);
    expect(String(server.MIMERS_ROOT)).not.toMatch(/mimer-demo/);
  });

  it('an external-target run starts no server and still strips the shell CAS from runner and workers', () => {
    const r = loadConfig({ PLAYWRIGHT_BASE_URL: 'https://203.0.113.10', ...SHELL_CAS_ENV });
    expect(r.error).toBeNull();
    expect(r.api).toBeNull();
    expect(casKeysOf(r.runner)).toEqual({});
  });
});

// TDG-4: removing ADMIN_ROLE_GRANT_CAS_ROOT sent adminRoleGrantService to its default,
// `.data/admin-role-grants` under cwd (the live tree when cwd is a worktree). It is now the one CAS
// key a worker and its children carry: a fresh temp root of the test file, never the shell's.
const isFreshTempRoot = (value: string | undefined, tmp: string) =>
  typeof value === 'string' &&
  path.isAbsolute(value) &&
  path
    .resolve(value)
    .toLowerCase()
    .startsWith(path.resolve(tmp).toLowerCase() + path.sep) &&
  path.basename(path.dirname(value)).startsWith('miljobeslut-test-data-');

describe('Vitest: no process a test starts inherits a shell CAS', () => {
  it('this worker has no CAS setting of the shell left after the setup file (only its own fresh grant root)', () => {
    expect(Object.keys(process.env).filter(isCasEnvKey)).toEqual(['ADMIN_ROLE_GRANT_CAS_ROOT']);
    expect(isFreshTempRoot(process.env.ADMIN_ROLE_GRANT_CAS_ROOT, os.tmpdir())).toBe(true);
  });

  it('the setup file removes MIMERS_ROOT=D:\\mimer-demo\\cas, so a child (and grandchild) never sees it', () => {
    const report = runChild(
      `
await import(${JSON.stringify(SETUP_URL)});
const { spawnSync } = await import('node:child_process');
const child = spawnSync(process.execPath, ['-e',
  "const k = Object.keys(process.env).filter((key) => /^MIMERS_|(^|_)CAS(_|$)/i.test(key));" +
  "process.stdout.write(JSON.stringify(Object.fromEntries(k.map((key) => [key, process.env[key]]))))"],
  { encoding: 'utf8' });
process.stdout.write('WTDG3_RESULT ' + JSON.stringify({ worker: process.env.MIMERS_ROOT ?? null, grant: process.env.ADMIN_ROLE_GRANT_CAS_ROOT ?? null, child: JSON.parse(child.stdout || 'null') }) + String.fromCharCode(10));
process.exit(0);
`,
      bareEnv({ ...SHELL_CAS_ENV, DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none' }),
    ) as { worker: string | null; grant: string | null; child: Record<string, string> };
    expect(report.worker).toBeNull();
    expect(isFreshTempRoot(report.grant ?? undefined, tmpRoot)).toBe(true);
    expect(report.child).toEqual({ ADMIN_ROLE_GRANT_CAS_ROOT: report.grant });
  });
});
