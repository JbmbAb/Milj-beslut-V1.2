// @vitest-environment node
import { exec, execFileSync, fork, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as policy from '../../server/modules/test-db-guard/testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-2 finding 2: every process a test starts is a test process with a
 * controlled environment -- it reads no env file at all (not `.env.local`, not `.env`), whatever
 * its working directory, also when the test strips VITEST and NODE_ENV to run a script "as an
 * operator would" (tests/unit/luBootstrapProofScriptsIsolation.test.ts did exactly that, with
 * cwd = the worktree, so its children loaded the live `.env.local`).
 *
 * Each child below is started from this Vitest worker in one of the ways the test chain starts
 * processes, with cwd = a temp dir holding FAKE `.env.local`, `.env` and `.env.test` (fabricated
 * `.invalid` values). The child runs the REAL server/loadEnvFirst.ts and then `dotenv/config`
 * (as server/services/importPathService.ts does) and reports what ended up in its env. Nothing
 * connects anywhere.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const DOTENV_CONFIG_URL = pathToFileURL(createRequire(import.meta.url).resolve('dotenv/config')).href;
const FAKE_URL = (where: string) =>
  `postgresql://wtdg2-fabricated:wtdg2-not-a-password@wtdg2-child-${where}.invalid:1/wtdg2_child_${where}`;

type ChildReport = {
  DATABASE_URL: string | null;
  WTDG2_CHILD_LOCAL_SENTINEL: string | null;
  WTDG2_CHILD_DOTENV_SENTINEL: string | null;
  grandchild?: ChildReport;
};

const CHILD_PROGRAM = `
import { spawnSync } from 'node:child_process';
const [loadEnvFirstUrl, dotenvConfigUrl, tsxLoaderUrl, mode] = process.argv.slice(2);
await import(loadEnvFirstUrl);
await import(dotenvConfigUrl);
const pick = (k) => (process.env[k] === undefined ? null : process.env[k]);
const report = {
  DATABASE_URL: pick('DATABASE_URL'),
  WTDG2_CHILD_LOCAL_SENTINEL: pick('WTDG2_CHILD_LOCAL_SENTINEL'),
  WTDG2_CHILD_DOTENV_SENTINEL: pick('WTDG2_CHILD_DOTENV_SENTINEL'),
};
if (mode === 'with-grandchild') {
  const r = spawnSync(process.execPath, ['--import', tsxLoaderUrl, process.argv[1], loadEnvFirstUrl, dotenvConfigUrl, tsxLoaderUrl, 'leaf'], { encoding: 'utf8' });
  const line = String(r.stdout).split(/\\r?\\n/).find((l) => l.startsWith('WTDG2_CHILD '));
  report.grandchild = line ? JSON.parse(line.slice('WTDG2_CHILD '.length)) : { error: String(r.stderr).slice(0, 500) };
}
process.stdout.write('WTDG2_CHILD ' + JSON.stringify(report) + String.fromCharCode(10));
`;

let fakeCwd: string;
let childProgram: string;

beforeAll(() => {
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg2-child-cwd-'));
  fs.writeFileSync(
    path.join(fakeCwd, '.env.local'),
    [`DATABASE_URL=${FAKE_URL('local')}`, 'WTDG2_CHILD_LOCAL_SENTINEL=loaded-from-the-fake-env-local'].join(
      '\n',
    ),
  );
  fs.writeFileSync(
    path.join(fakeCwd, '.env'),
    [`DATABASE_URL=${FAKE_URL('dotenv')}`, 'WTDG2_CHILD_DOTENV_SENTINEL=loaded-from-the-fake-env'].join('\n'),
  );
  childProgram = path.join(fakeCwd, 'wtdg2-child.mjs');
  fs.writeFileSync(childProgram, CHILD_PROGRAM);
});

afterAll(() => {
  fs.rmSync(fakeCwd, { recursive: true, force: true });
});

const childArgs = (mode = 'leaf') => [
  childProgram,
  LOAD_ENV_FIRST_URL,
  DOTENV_CONFIG_URL,
  TSX_LOADER_URL,
  mode,
];
const nodeArgs = (mode = 'leaf') => ['--import', TSX_LOADER_URL, ...childArgs(mode)];

function parseReport(stdout: string, stderr: string): ChildReport {
  const line = String(stdout)
    .split(/\r?\n/)
    .find((l) => l.startsWith('WTDG2_CHILD '));
  if (!line) throw new Error(`child produced no report: ${String(stderr).slice(0, 2000)}`);
  return JSON.parse(line.slice('WTDG2_CHILD '.length)) as ChildReport;
}

function viaSpawnSync(env?: NodeJS.ProcessEnv, mode = 'leaf'): ChildReport {
  const r = spawnSync(process.execPath, nodeArgs(mode), {
    cwd: fakeCwd,
    encoding: 'utf8',
    timeout: 90_000,
    ...(env ? { env } : {}),
  });
  return parseReport(r.stdout, r.stderr);
}

function viaAsync(start: () => ReturnType<typeof spawn>): Promise<ChildReport> {
  return new Promise((resolve, reject) => {
    const child = start();
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(parseReport(stdout, stderr));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** What a hermetic test child must report: the parent's DATABASE_URL, nothing from env files. */
function expectHermetic(report: ChildReport): void {
  expect(report).toMatchObject({
    DATABASE_URL: process.env.DATABASE_URL ?? null,
    WTDG2_CHILD_LOCAL_SENTINEL: null,
    WTDG2_CHILD_DOTENV_SENTINEL: null,
  });
}

describe('TEST-DB-GUARD: this worker hands every process its tests start the hermetic test marker', () => {
  it('the worker itself carries MIMER_TEST_MODE=vitest-worker:<its own pid> and stays non-hermetic', () => {
    expect(process.env.MIMER_TEST_MODE).toBe(`vitest-worker:${process.pid}`);
    expect(policy.isHermeticTestProcess(process.env, process.pid)).toBe(false);
    expect(policy.isTestRuntime({ MIMER_TEST_MODE: `vitest-worker:${process.pid}` })).toBe(true);
  });

  it('any other process carrying it, and an explicit MIMER_TEST_MODE=1, is hermetic', () => {
    expect(policy.isHermeticTestProcess({ MIMER_TEST_MODE: 'vitest-worker:4242' }, 4243)).toBe(true);
    expect(policy.isHermeticTestProcess({ MIMER_TEST_MODE: '1' }, 4243)).toBe(true);
    expect(policy.isHermeticTestProcess({ MIMER_TEST_MODE: '0' }, 4243)).toBe(false);
    expect(policy.isTestRuntime({ MIMER_TEST_MODE: 'vitest-worker:4242' })).toBe(true);
  });
});

describe('TEST-DB-GUARD: a test child reads no env file in its cwd, however it is started', () => {
  it('spawnSync, inherited env (no env option)', () => {
    expectHermetic(viaSpawnSync());
  });

  it('spawnSync, env: process.env', () => {
    expectHermetic(viaSpawnSync(process.env));
  });

  it("an operator-style env: VITEST*, NODE_ENV and MIMERS_* stripped (the LU proof scripts' test)", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('VITEST') || key.startsWith('MIMERS_') || key === 'NODE_ENV') delete env[key];
    }
    expectHermetic(viaSpawnSync(env));
  });

  it('execFileSync, env: { ...process.env, extra }', () => {
    const out = execFileSync(process.execPath, nodeArgs(), {
      cwd: fakeCwd,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, WTDG2_EXTRA: 'x' },
    });
    expectHermetic(parseReport(out, ''));
  });

  it('async spawn, inherited env', async () => {
    expectHermetic(await viaAsync(() => spawn(process.execPath, nodeArgs(), { cwd: fakeCwd })));
  });

  it('fork, inherited env', async () => {
    expectHermetic(
      await viaAsync(
        () =>
          fork(childArgs()[0], childArgs().slice(1), {
            cwd: fakeCwd,
            execArgv: ['--import', TSX_LOADER_URL],
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          }) as unknown as ReturnType<typeof spawn>,
      ),
    );
  });

  it('exec through a shell, inherited env', async () => {
    const command = [process.execPath, ...nodeArgs()].map((part) => `"${part}"`).join(' ');
    const report = await new Promise<ChildReport>((resolve, reject) => {
      exec(command, { cwd: fakeCwd, timeout: 90_000 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(parseReport(String(stdout), String(stderr)));
      });
    });
    expectHermetic(report);
  });

  it("a grandchild started by the child with the child's env", () => {
    const report = viaSpawnSync(undefined, 'with-grandchild');
    expectHermetic(report);
    expectHermetic(report.grandchild as ChildReport);
  });

  it('an env built from scratch with MIMER_TEST_MODE=1 (what a from-scratch test env must carry)', () => {
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
    env.MIMER_TEST_MODE = '1';
    env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/wtdg2_from_scratch';
    expect(viaSpawnSync(env)).toMatchObject({
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/wtdg2_from_scratch',
      WTDG2_CHILD_LOCAL_SENTINEL: null,
      WTDG2_CHILD_DOTENV_SENTINEL: null,
    });
  });
});
