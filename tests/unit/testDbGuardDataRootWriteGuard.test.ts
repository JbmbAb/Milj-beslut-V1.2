// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-4 (owner decision 2026-10-03 (4) point 8; SWEEP-REPORT "Skrivningar i
 * arbetskatalogen"): with cwd in a product worktree, tests wrote into its live roots although the database
 * was safe -- storage/drafts (documentGenerator via municipalitySubmissionService), storage/manifests,
 * tmp-artifacts, tests/fixtures. In a test process every write, mkdir, copy, rename or removal inside a live
 * data root of a product tree is now refused before anything happens.
 *
 * Every write here targets a FAKE product tree in this test's temp directory (package.json + server/ +
 * packages/), so even with the guard broken nothing lands in a real tree. The behavioural cases use only the
 * real setup file, the real server/loadEnvFirst.ts, the real playwright.config.ts and the real
 * documentGenerator -- so on the code before TDG-4 they fail on the write itself, not on a missing module.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SETUP_URL = pathToFileURL(path.join(REPO_ROOT, 'tests/setup/testDatabaseGuard.ts')).href;
const LOAD_ENV_FIRST_URL = pathToFileURL(path.join(REPO_ROOT, 'server/loadEnvFirst.ts')).href;
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href;
const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const GUARD_MODULE = '../../server/modules/test-db-guard/installTestDataRootWriteGuard';
const REFUSED = 'TEST_DATA_ROOT_WRITE_REFUSED';
const DEAD_DB = 'postgresql://x:x@127.0.0.1:1/none';

let tmpRoot: string;
let fakeTree: string;

function makeFakeProductTree(dir: string): void {
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fake-product-tree"}\n');
  // live roots that already hold data: a removal must not reach them either
  fs.mkdirSync(path.join(dir, 'storage', 'keep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'storage', 'keep', 'live.txt'), 'live');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'source.txt'), 'outside every root');
}

/** Every file and directory under `dir`, relative (the evidence that nothing was written). */
function listing(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(entry.isDirectory() ? `${child}/` : child);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk('');
  return out.sort();
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg4-wg-'));
  fakeTree = path.join(tmpRoot, 'fake-tree');
  makeFakeProductTree(fakeTree);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function bareEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'HOME', 'USERPROFILE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot, ...extra };
}

/** In a child (cwd = the fake tree): load `entry`, then attempt every kind of write into live roots. */
const ATTEMPTS = `
const fs = await import('node:fs');
const { writeFile, mkdir } = await import('node:fs/promises');
const results = {};
const attempt = async (name, fn) => {
  try { await fn(); results[name] = 'WROTE'; } catch (e) { results[name] = e && e.code ? e.code : String(e && e.message); }
};
await attempt('mkdirSync storage/drafts', () => fs.mkdirSync('storage/drafts', { recursive: true }));
await attempt('writeFileSync .quarantine', () => { fs.mkdirSync('.quarantine', { recursive: true }); fs.writeFileSync('.quarantine/x.bin', 'x'); });
await attempt('fs/promises writeFile .data/admin-role-grants', async () => { await mkdir('.data/admin-role-grants', { recursive: true }); await writeFile('.data/admin-role-grants/g.json', '{}'); });
await attempt('appendFileSync tmp-artifacts', () => { fs.mkdirSync('tmp-artifacts', { recursive: true }); fs.appendFileSync('tmp-artifacts/evidence.json', 'x'); });
await attempt('copyFileSync tests/fixtures', () => { fs.mkdirSync('tests/fixtures', { recursive: true }); fs.copyFileSync('source.txt', 'tests/fixtures/copied.txt'); });
await attempt('createWriteStream storage', () => new Promise((resolve, reject) => { const s = fs.createWriteStream('storage/keep/stream.txt'); s.on('error', reject); s.end('x', resolve); }));
await attempt('renameSync into storage', () => { fs.writeFileSync('moved.txt', 'x'); fs.renameSync('moved.txt', 'storage/keep/moved.txt'); });
await attempt('openSync w docs', () => fs.closeSync(fs.openSync('docs/opened.txt', 'w')));
await attempt('callback writeFile storage', () => new Promise((resolve, reject) => fs.writeFile('storage/keep/cb.txt', 'x', (e) => (e ? reject(e) : resolve()))));
await attempt('unlinkSync a live file', () => fs.unlinkSync('storage/keep/live.txt'));
await attempt('rmSync storage (recursive)', () => fs.rmSync('storage', { recursive: true, force: true }));
await attempt('control: writeFileSync outside every root', () => fs.writeFileSync('outside.txt', 'x'));
try { results.readStillWorks = fs.readFileSync('storage/keep/live.txt', 'utf8'); } catch (e) { results.readStillWorks = String(e && e.code); }
process.stdout.write('WTDG4_RESULT ' + JSON.stringify(results) + String.fromCharCode(10));
process.exit(0);
`;

function runChild(code: string, env: NodeJS.ProcessEnv, cwd: string): Record<string, string> {
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER_URL, '--input-type=module', '-e', code],
    {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const line = String(result.stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('WTDG4_RESULT '));
  if (!line) throw new Error(`child produced no result: ${String(result.stderr ?? '').slice(0, 2000)}`);
  return JSON.parse(line.slice('WTDG4_RESULT '.length));
}

function freshFakeTree(name: string): string {
  const dir = path.join(tmpRoot, name);
  makeFakeProductTree(dir);
  return dir;
}

function expectEveryWriteRefused(results: Record<string, string>, tree: string, before: string[]): void {
  const { readStillWorks, ['control: writeFileSync outside every root']: control, ...writes } = results;
  for (const [name, outcome] of Object.entries(writes))
    expect({ name, outcome }).toEqual({ name, outcome: REFUSED });
  // not a blanket refusal: a write outside every root still works, and so does every read
  expect(control).toBe('WROTE');
  expect(readStillWorks).toBe('live');
  // nothing changed in the tree but the two files written outside every root
  expect(listing(tree)).toEqual([...before, 'moved.txt', 'outside.txt'].sort());
}

describe('a test process never writes into a live data root of a product tree', () => {
  it('Vitest setup file: every kind of write, mkdir, copy, rename and removal is refused; reads work; nothing changes', () => {
    const tree = freshFakeTree('vitest-setup');
    const before = listing(tree);
    const results = runChild(
      `await import(${JSON.stringify(SETUP_URL)});\n${ATTEMPTS}`,
      bareEnv({ DATABASE_URL: DEAD_DB }),
      tree,
    );
    expectEveryWriteRefused(results, tree, before);
  });

  it('server/loadEnvFirst.ts in a NODE_ENV=test or MIMER_TEST_MODE process (a test child, the E2E API server)', () => {
    for (const marker of [{ NODE_ENV: 'test' }, { MIMER_TEST_MODE: '1' }]) {
      const tree = freshFakeTree(`load-env-first-${Object.keys(marker)[0]}`);
      const before = listing(tree);
      const results = runChild(
        `await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});\n${ATTEMPTS}`,
        bareEnv({ DATABASE_URL: DEAD_DB, ...marker }),
        tree,
      );
      expectEveryWriteRefused(results, tree, before);
    }
  });

  it('playwright.config.ts: the runner and every worker that loads it', () => {
    const tree = freshFakeTree('playwright');
    const before = listing(tree);
    const results = runChild(
      `await import(${JSON.stringify(CONFIG_URL)});\n${ATTEMPTS}`,
      bareEnv({ PLAYWRIGHT_BASE_URL: 'https://203.0.113.10' }),
      tree,
    );
    expectEveryWriteRefused(results, tree, before);
  });

  it('outside a test runtime nothing is guarded (product behaviour unchanged)', () => {
    const tree = freshFakeTree('no-test-runtime');
    const results = runChild(
      `await import(${JSON.stringify(LOAD_ENV_FIRST_URL)});\n${ATTEMPTS}`,
      bareEnv({ NODE_ENV: 'development', DATABASE_URL: DEAD_DB }),
      tree,
    );
    expect(results['mkdirSync storage/drafts']).toBe('WROTE');
    expect(results['writeFileSync .quarantine']).toBe('WROTE');
    expect(results['rmSync storage (recursive)']).toBe('WROTE');
    expect(fs.existsSync(path.join(tree, '.quarantine', 'x.bin'))).toBe(true);
  });
});

describe('the product default that wrote into the tree: documentGenerator (storage/drafts)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('this worker carries the guard: a draft in <cwd>/storage/drafts of a product tree is refused, nothing is written', async () => {
    const tree = freshFakeTree('document-generator');
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const { generateApplicationDraft } = await import('../../server/services/documentGenerator');
    const error = await generateApplicationDraft({
      projectId: 'p',
      organisationId: 'o',
      requirementData: { requirements: [] },
      userId: 'u',
    }).then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string },
    );
    expect(error?.code).toBe(REFUSED);
    expect(String(error?.message)).toContain(path.join(tree, 'storage'));
    expect(listing(tree)).toEqual(before);
  });
});

describe('tests/setup/env.ts creates coverage/.tmp only when coverage runs', () => {
  it('the worker state it reads exists and is a strict boolean (false in a run without coverage)', () => {
    const state = (globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: unknown } } } })
      .__vitest_worker__;
    expect(state?.config?.coverage?.enabled).toBe(false);
    const source = fs.readFileSync(path.join(REPO_ROOT, 'tests/setup/env.ts'), 'utf8');
    expect(source).toMatch(
      /__vitest_worker__\?\.config\?\.coverage\?\.enabled === true\)\s*\{\s*try \{\s*fs\.mkdirSync\(/,
    );
  });
});

describe('the decision (server/modules/test-db-guard/installTestDataRootWriteGuard.ts)', () => {
  it('this worker has the guard installed by the setup file', async () => {
    const { testDataRootWriteGuardInstalled } = await import(GUARD_MODULE);
    expect(testDataRootWriteGuardInstalled()).toBe(true);
  });

  it('protects each root under the product tree and a product-tree cwd; not a temp dir, not a sibling name', async () => {
    const { testDataRootWriteRefusal, TEST_PROTECTED_RELATIVE_ROOTS, THIS_PRODUCT_TREE } = await import(
      GUARD_MODULE
    );
    for (const { root } of TEST_PROTECTED_RELATIVE_ROOTS as Array<{ root: string }>) {
      for (const tree of [THIS_PRODUCT_TREE, fakeTree]) {
        const target = path.join(tree, root, 'x', 'y.json');
        const refusal = testDataRootWriteRefusal('fs.writeFileSync', 'write', target, {
          cwd: fakeTree,
          testFile: null,
        });
        expect({ root, tree, refused: Boolean(refusal) }).toEqual({ root, tree, refused: true });
      }
    }
    const cwdIsNotATree = path.join(tmpRoot, 'not-a-tree');
    fs.mkdirSync(cwdIsNotATree, { recursive: true });
    expect(
      testDataRootWriteRefusal('fs.mkdirSync', 'mkdir', path.join(cwdIsNotATree, 'storage'), {
        cwd: cwdIsNotATree,
        testFile: null,
      }),
    ).toBeNull();
    expect(
      testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(os.tmpdir(), 'storage', 'x'), {
        testFile: null,
      }),
    ).toBeNull();
    expect(
      testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(fakeTree, 'storage-not', 'x'), {
        cwd: fakeTree,
        testFile: null,
      }),
    ).toBeNull();
    expect(
      testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(fakeTree, 'tests', 'unit', 'x.txt'), {
        cwd: fakeTree,
        testFile: null,
      }),
    ).toBeNull();
  });

  it('a removal of an ANCESTOR of a protected root is refused too', async () => {
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    expect(
      testDataRootWriteRefusal('fs.rmSync', 'remove', fakeTree, { cwd: fakeTree, testFile: null }),
    ).not.toBeNull();
    expect(
      testDataRootWriteRefusal('fs.rmSync', 'remove', path.join(fakeTree, 'tests'), {
        cwd: fakeTree,
        testFile: null,
      }),
    ).not.toBeNull();
    expect(
      testDataRootWriteRefusal('fs.mkdirSync', 'mkdir', path.join(fakeTree, 'tests'), {
        cwd: fakeTree,
        testFile: null,
      }),
    ).toBeNull();
  });

  it('the absolute live defaults are refused (decided only -- nothing is ever attempted there)', async () => {
    const { testDataRootWriteRefusal, TEST_PROTECTED_ABSOLUTE_ROOTS } = await import(GUARD_MODULE);
    for (const { root } of TEST_PROTECTED_ABSOLUTE_ROOTS as Array<{ root: string }>) {
      if (process.platform !== 'win32' && /^[A-Za-z]:\\/.test(root)) continue;
      const refusal = testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(root, 'x.json'), {
        testFile: null,
      });
      expect({ root, refused: Boolean(refusal) }).toEqual({ root, refused: true });
    }
  });

  it('an exception allows exactly its file (and its parent dirs) during exactly its test file', async () => {
    const { testDataRootWriteRefusal, TEST_DATA_ROOT_WRITE_EXCEPTIONS } = await import(GUARD_MODULE);
    for (const exception of TEST_DATA_ROOT_WRITE_EXCEPTIONS as Array<{ path: string; testFile: string }>) {
      const owner = path.join(fakeTree, exception.testFile);
      const file = path.join(fakeTree, exception.path);
      const opts = { cwd: fakeTree, trees: [fakeTree], testFile: owner };
      expect(testDataRootWriteRefusal('fs.writeFileSync', 'write', file, opts)).toBeNull();
      expect(testDataRootWriteRefusal('fs.mkdirSync', 'mkdir', path.dirname(file), opts)).toBeNull();
      // a sibling, a removal, another test file, no test file at all: refused
      expect(testDataRootWriteRefusal('fs.writeFileSync', 'write', `${file}.other`, opts)).not.toBeNull();
      expect(testDataRootWriteRefusal('fs.rmSync', 'remove', file, opts)).not.toBeNull();
      expect(
        testDataRootWriteRefusal('fs.writeFileSync', 'write', file, {
          ...opts,
          testFile: path.join(fakeTree, 'tests/unit/other.test.ts'),
        }),
      ).not.toBeNull();
      expect(
        testDataRootWriteRefusal('fs.writeFileSync', 'write', file, { ...opts, testFile: null }),
      ).not.toBeNull();
    }
  });
});
