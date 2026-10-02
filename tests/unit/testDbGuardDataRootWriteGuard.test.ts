// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
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

// ---------------------------------------------------------------------------------------------------
// TDG-5 (TDG4-VERIFICATION findings 2, 3, 8, 9, 12 and 4): every write surface in all three styles, the
// real bypass (a recursive copy onto the tree root), the forms Windows resolves to the same file, the
// exceptions' scope, and the workstation's actual live roots.

type Style = 'sync' | 'callback' | 'promise';
const STYLES: readonly Style[] = ['sync', 'callback', 'promise'];
const isWin = process.platform === 'win32';
const caseInsensitiveFs = isWin || process.platform === 'darwin';

/** Calls node:fs `name` in one style (the module object the guard patches). */
function fsCall(style: Style, name: string, ...args: unknown[]): Promise<unknown> {
  const anyFs = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  if (style === 'sync') return new Promise((resolve) => resolve(anyFs[`${name}Sync`](...args)));
  if (style === 'promise')
    return (fs.promises as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...args);
  return new Promise((resolve, reject) =>
    anyFs[name](...args, (error: unknown, value: unknown) => (error ? reject(error) : resolve(value))),
  );
}

/** 'WROTE' or the error code; an opened descriptor/handle is closed again. */
async function outcomeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    const value = await run();
    if (typeof value === 'number') fs.closeSync(value);
    else if (value && typeof (value as { close?: unknown }).close === 'function')
      await (value as { close: () => Promise<void> }).close();
    return 'WROTE';
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return typeof code === 'string' ? code : String((error as Error)?.message ?? error);
  }
}

/** Every path that a broken guard could turn into a link: removed (never recursively) before cleanup. */
const linkPathsToRemove: string[] = [];

function removeLinksThenTree(root: string): void {
  for (const link of linkPathsToRemove.splice(0)) {
    const stat = (() => {
      try {
        return fs.lstatSync(link);
      } catch {
        return null;
      }
    })();
    if (!stat) continue;
    // a junction or directory symlink is removed as the link itself, never through it
    if (stat.isSymbolicLink() || stat.isDirectory()) fs.rmdirSync(link);
    else fs.unlinkSync(link);
  }
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        process.stderr.write(`[wtdg5] link left behind, ${root} kept: ${full}\n`);
        return; // never delete recursively through a link
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

describe('TDG-5: every write surface is refused -- sync, callback and promise -- and nothing changes', () => {
  let area: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg5-surfaces-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  for (const style of STYLES) {
    it(`${style}: cp onto the tree root (recursive) and into a root, copyFile, rename (both ends, onto an ancestor), rm, symlink (both ends), link (both names), truncate, open r+/rs+/O_RDWR, a file: URL, mkdir, mkdtemp, utimes, chmod`, async () => {
      const tree = path.join(area, `tree-${style}`);
      const outside = path.join(area, `outside-${style}`);
      makeFakeProductTree(tree);
      fs.mkdirSync(path.join(outside, 'src-tree', 'storage', 'drafts'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'src-tree', 'storage', 'drafts', 'landed.docx'), 'x');
      fs.mkdirSync(path.join(outside, 'ren', 'fixtures'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'ren', 'fixtures', 'landed.txt'), 'x');
      fs.writeFileSync(path.join(outside, 'file.txt'), 'outside');
      fs.mkdirSync(path.join(outside, 'sub'), { recursive: true });
      const live = path.join(tree, 'storage', 'keep', 'live.txt');
      const keep = path.join(tree, 'storage', 'keep');
      const relTargetFromSub = path.relative(path.join(outside, 'sub'), keep);
      linkPathsToRemove.push(
        path.join(outside, 'alias'),
        path.join(outside, 'sub', 'alias-rel'),
        path.join(keep, 'link'),
        path.join(outside, 'hard.txt'),
        path.join(keep, 'hard.txt'),
      );
      const treeBefore = listing(tree);
      const outsideBefore = listing(outside);
      vi.spyOn(process, 'cwd').mockReturnValue(tree);
      const c = fs.constants;
      const attempts: Record<string, () => Promise<unknown>> = {
        'cp dir onto the tree root, recursive': () =>
          fsCall(style, 'cp', path.join(outside, 'src-tree'), tree, { recursive: true }),
        'cp a file into storage': () =>
          fsCall(style, 'cp', path.join(outside, 'file.txt'), path.join(keep, 'cp.txt'), {}),
        'copyFile into storage': () =>
          fsCall(style, 'copyFile', path.join(outside, 'file.txt'), path.join(keep, 'copy.txt')),
        'rename a dir onto an ancestor of tests/fixtures': () =>
          fsCall(style, 'rename', path.join(outside, 'ren'), path.join(tree, 'tests')),
        'rename a file into storage': () =>
          fsCall(style, 'rename', path.join(outside, 'file.txt'), path.join(keep, 'moved.txt')),
        'rename a live file out': () => fsCall(style, 'rename', live, path.join(outside, 'stolen.txt')),
        'rm storage recursive': () =>
          fsCall(style, 'rm', path.join(tree, 'storage'), { recursive: true, force: true }),
        'rm the tree recursive': () => fsCall(style, 'rm', tree, { recursive: true, force: true }),
        'symlink (junction) from outside INTO storage': () =>
          fsCall(style, 'symlink', keep, path.join(outside, 'alias'), 'junction'),
        'symlink (junction), relative target, from outside INTO storage': () =>
          fsCall(style, 'symlink', relTargetFromSub, path.join(outside, 'sub', 'alias-rel'), 'junction'),
        'symlink placed inside storage': () =>
          fsCall(style, 'symlink', outside, path.join(keep, 'link'), 'junction'),
        'link a live file out (hard link)': () => fsCall(style, 'link', live, path.join(outside, 'hard.txt')),
        'link into storage (hard link)': () =>
          fsCall(style, 'link', path.join(outside, 'file.txt'), path.join(keep, 'hard.txt')),
        'truncate a live file': () => fsCall(style, 'truncate', live, 0),
        'open r+ a live file': () => fsCall(style, 'open', live, 'r+'),
        'open rs+ a live file': () => fsCall(style, 'open', live, 'rs+'),
        'open O_RDWR a live file': () => fsCall(style, 'open', live, c.O_RDWR),
        'writeFile through a file: URL': () =>
          fsCall(style, 'writeFile', pathToFileURL(path.join(keep, 'url.txt')), 'x'),
        'mkdir in storage': () => fsCall(style, 'mkdir', path.join(keep, 'new-dir'), { recursive: true }),
        'mkdtemp in storage': () => fsCall(style, 'mkdtemp', path.join(keep, 'tmp-')),
        'utimes a live file': () => fsCall(style, 'utimes', live, new Date(0), new Date(0)),
        'chmod a live file': () => fsCall(style, 'chmod', live, 0o666),
      };
      const results: Record<string, string> = {};
      for (const [name, run] of Object.entries(attempts)) results[name] = await outcomeOf(run);
      // controls: a recursive copy and a write outside every root still work (not a blanket refusal)
      results['control: cp dir into a temp dir'] = await outcomeOf(() =>
        fsCall(style, 'cp', path.join(outside, 'src-tree'), path.join(area, `copy-ok-${style}`), {
          recursive: true,
        }),
      );
      vi.restoreAllMocks();
      expect(results).toEqual({
        ...Object.fromEntries(Object.keys(attempts).map((name) => [name, REFUSED])),
        'control: cp dir into a temp dir': 'WROTE',
      });
      expect(listing(tree)).toEqual(treeBefore);
      expect(listing(outside)).toEqual(outsideBefore);
      expect(fs.readFileSync(live, 'utf8')).toBe('live');
    });
  }

  it.runIf(caseInsensitiveFs)(
    'another spelling of the same file (case) is refused, written and decided',
    async () => {
      const tree = path.join(area, 'tree-case');
      makeFakeProductTree(tree);
      const before = listing(tree);
      vi.spyOn(process, 'cwd').mockReturnValue(tree);
      const upper = path.join(tree.toUpperCase(), 'STORAGE', 'KEEP', 'UPPER.TXT');
      const outcome = await outcomeOf(() => fsCall('sync', 'writeFile', upper, 'x'));
      vi.restoreAllMocks();
      expect(outcome).toBe(REFUSED);
      expect(listing(tree)).toEqual(before);
      const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
      // as written, without the real-path lookup: the case-folded comparison alone refuses it
      expect(
        testDataRootWriteRefusal('fs.writeFileSync', 'write', upper, {
          trees: [tree],
          testFile: null,
          resolveLinks: false,
        }),
      ).not.toBeNull();
    },
  );
});

describe('TDG-5: the forms Windows resolves to the same file (findings 8 and 10)', () => {
  let area: string;
  let tree: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg5-forms-'));
    tree = path.join(area, 'tree');
    makeFakeProductTree(tree);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  const decideAsWritten = async (target: string) => {
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    return testDataRootWriteRefusal('fs.writeFileSync', 'write', target, {
      trees: [tree],
      testFile: null,
      resolveLinks: false,
    });
  };

  it.runIf(isWin)(
    '\\\\?\\, \\\\.\\, \\\\?\\UNC\\localhost\\C$, \\\\localhost\\C$, an NTFS stream and a trailing dot are the root, as written',
    async () => {
      const inStorage = path.join(tree, 'storage', 'keep', 'x.txt');
      const drive = inStorage.slice(0, 1);
      const rest = inStorage.slice(3); // after "C:\"
      const forms = {
        win32File: `\\\\?\\${inStorage}`,
        win32Device: `\\\\.\\${inStorage}`,
        uncLong: `\\\\?\\UNC\\localhost\\${drive}$\\${rest}`,
        adminShare: `\\\\localhost\\${drive}$\\${rest}`,
        loopbackShare: `\\\\127.0.0.1\\${drive}$\\${rest}`,
        streamOnRoot: `${path.join(tree, 'storage')}:ads`,
        streamOnFile: `${inStorage}:s:$DATA`,
        trailingDot: path.join(tree, 'storage.', 'keep', 'x.txt'),
        trailingSpace: `${path.join(tree, 'storage')} \\keep\\x.txt`,
      };
      const decided: Record<string, boolean> = {};
      for (const [name, target] of Object.entries(forms))
        decided[name] = Boolean(await decideAsWritten(target));
      expect(decided).toEqual(Object.fromEntries(Object.keys(forms).map((name) => [name, true])));
      // not over-wide: a sibling that only starts with the root's name is still outside
      expect(await decideAsWritten(path.join(tree, 'storage-not', 'x.txt'))).toBeNull();
    },
  );

  it.runIf(isWin)(
    'written for real: \\\\?\\, \\\\.\\ and an NTFS stream on the root directory are refused, nothing lands',
    async () => {
      const before = listing(tree);
      vi.spyOn(process, 'cwd').mockReturnValue(tree);
      const keep = path.join(tree, 'storage', 'keep');
      const results = {
        win32File: await outcomeOf(() =>
          fsCall('sync', 'writeFile', `\\\\?\\${path.join(keep, 'a.txt')}`, 'x'),
        ),
        win32Device: await outcomeOf(() =>
          fsCall('sync', 'writeFile', `\\\\.\\${path.join(keep, 'b.txt')}`, 'x'),
        ),
        streamOnRoot: await outcomeOf(() =>
          fsCall('sync', 'writeFile', `${path.join(tree, 'storage')}:ads`, 'x'),
        ),
      };
      vi.restoreAllMocks();
      expect(results).toEqual({ win32File: REFUSED, win32Device: REFUSED, streamOnRoot: REFUSED });
      expect(listing(tree)).toEqual(before);
    },
  );

  it('through a junction (or symlink) from outside into a root: refused via the real path, nothing lands', async () => {
    const outside = path.join(area, 'outside-link');
    fs.mkdirSync(outside, { recursive: true });
    const junction = path.join(outside, 'into-storage');
    linkPathsToRemove.push(junction);
    // made BEFORE cwd points at the fake tree: a link that already exists (the guard refuses making it now)
    fs.symlinkSync(path.join(tree, 'storage', 'keep'), junction, isWin ? 'junction' : 'dir');
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const results = {
      writeThroughLink: await outcomeOf(() =>
        fsCall('sync', 'writeFile', path.join(junction, 'via.txt'), 'x'),
      ),
      mkdirThroughLink: await outcomeOf(() => fsCall('promise', 'mkdir', path.join(junction, 'via-dir'))),
      truncateThroughLink: await outcomeOf(() =>
        fsCall('callback', 'truncate', path.join(junction, 'live.txt'), 0),
      ),
    };
    vi.restoreAllMocks();
    expect(results).toEqual({
      writeThroughLink: REFUSED,
      mkdirThroughLink: REFUSED,
      truncateThroughLink: REFUSED,
    });
    expect(listing(tree)).toEqual(before);
    expect(fs.readFileSync(path.join(tree, 'storage', 'keep', 'live.txt'), 'utf8')).toBe('live');
  });

  it('through a DANGLING junction (or symlink) whose target would be created inside a root: the link is followed', async () => {
    const outside = path.join(area, 'outside-dangling');
    fs.mkdirSync(outside, { recursive: true });
    const dangling = path.join(outside, 'into-not-yet');
    linkPathsToRemove.push(dangling);
    // the target does not exist (yet): realpath fails on the link itself, so the guard reads the link
    fs.symlinkSync(path.join(tree, 'storage', 'keep', 'not-yet'), dangling, isWin ? 'junction' : 'dir');
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    const decide = (target: string, resolveLinks = true) =>
      testDataRootWriteRefusal('fs.writeFileSync', 'write', target, {
        trees: [tree],
        testFile: null,
        resolveLinks,
      });
    expect(decide(path.join(dangling, 'x.txt'), false)).toBeNull(); // as written: outside every root
    expect(decide(path.join(dangling, 'x.txt'))?.protectedRoot).toBe(path.join(tree, 'storage'));
    expect(decide(path.join(dangling, 'deeper', 'x.txt'))?.protectedRoot).toBe(path.join(tree, 'storage'));
  });

  it.runIf(isWin)('through an 8.3 short name of the tree: refused via the real path', async (ctx) => {
    const query = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${tree}") do @echo %~sI`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    const short = String(query.stdout ?? '').trim();
    if (!short || short.toLowerCase() === tree.toLowerCase()) ctx.skip(); // no 8.3 names on this volume
    expect(await decideAsWritten(path.join(short, 'storage', 'keep', 's.txt'))).toBeNull(); // as written: not seen
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const outcome = await outcomeOf(() =>
      fsCall('sync', 'writeFile', path.join(short, 'storage', 'keep', 's.txt'), 'x'),
    );
    vi.restoreAllMocks();
    expect(outcome).toBe(REFUSED);
    expect(listing(tree)).toEqual(before);
  });
});

describe('TDG-5: an exception is exactly its file and its own parents, for exactly its owner (finding 2: M04, M05; finding 12)', () => {
  it('the owner is matched by its full path, never by its name; nothing beside the file, no mkdtemp, no recursive copy', async () => {
    const { testDataRootWriteRefusal, TEST_DATA_ROOT_WRITE_EXCEPTIONS } = await import(GUARD_MODULE);
    for (const exception of TEST_DATA_ROOT_WRITE_EXCEPTIONS as Array<{ path: string; testFile: string }>) {
      const owner = path.join(fakeTree, exception.testFile);
      const file = path.join(fakeTree, exception.path);
      const parent = path.dirname(file);
      const opts = { cwd: fakeTree, trees: [fakeTree], testFile: owner };
      const refused = (op: string, kind: string, target: string, o: object = opts) =>
        Boolean(testDataRootWriteRefusal(op, kind, target, o));
      // the same file name in another directory is another test file
      const namesake = path.join(fakeTree, 'tests', 'unit', 'elsewhere', path.basename(exception.testFile));
      expect({
        exception: exception.path,
        namesake: refused('fs.writeFileSync', 'write', file, { ...opts, testFile: namesake }),
      }).toEqual({ exception: exception.path, namesake: true });
      // mkdir: the file's own ancestors only
      expect(refused('fs.mkdirSync', 'mkdir', parent)).toBe(false);
      expect(refused('fs.mkdirSync', 'mkdir', path.join(parent, 'beside'))).toBe(true);
      expect(refused('fs.mkdirSync', 'mkdir', path.join(path.dirname(parent), 'sibling-dir'))).toBe(true);
      expect(refused('fs.mkdirSync', 'mkdir', file)).toBe(true);
      // a unique directory next to a prefix, a recursive copy or a link are never excepted
      expect(refused('fs.mkdtempSync', 'mkdtemp', parent)).toBe(true);
      expect(refused('fs.mkdtempSync', 'mkdtemp', path.join(parent, 'x-'))).toBe(true);
      expect(refused('fs.cpSync', 'tree', file)).toBe(true);
      expect(refused('fs.cpSync', 'tree', parent)).toBe(true);
    }
  });

  it("finding 12 (E04), written for real: while an owner runs, mkdtemp on its exception's parent prefix makes no sibling", () => {
    const tree = freshFakeTree('owner-mkdtemp');
    const exception = {
      path: 'tests/fixtures/EndToEnd/Case_Fusion/original/beslut.txt',
      testFile: 'packages/mps-lu/tests/LUEndToEnd.test.ts',
    };
    fs.mkdirSync(path.join(tree, 'tests', 'fixtures', 'EndToEnd'), { recursive: true });
    const before = listing(tree);
    const state = (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__ as {
      filepath?: string;
    };
    const ownFile = state.filepath;
    const results: Record<string, string> = {};
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    try {
      state.filepath = path.join(tree, exception.testFile); // the owner, for these two synchronous calls only
      for (const [name, prefix] of [
        [
          'mkdtemp on an ancestor of the exception',
          path.join(tree, 'tests', 'fixtures', 'EndToEnd', 'Case_Fusion'),
        ],
        ['mkdtemp beside the exception', path.join(tree, 'tests', 'fixtures', 'EndToEnd', 'x-')],
      ] as const) {
        try {
          fs.mkdtempSync(prefix);
          results[name] = 'WROTE';
        } catch (error) {
          results[name] = String((error as { code?: string }).code);
        }
      }
    } finally {
      state.filepath = ownFile;
      vi.restoreAllMocks();
    }
    expect(results).toEqual({
      'mkdtemp on an ancestor of the exception': REFUSED,
      'mkdtemp beside the exception': REFUSED,
    });
    expect(listing(tree)).toEqual(before);
  });
});

describe("TDG-5: the workstation's actual live roots (finding 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.runIf(isWin)(
    "the demonstrator's D:\\mimer-demo -- cas and secrets, every level -- decided only, nothing is touched there",
    async () => {
      const { testDataRootWriteRefusal, MIMER_DEMO_LIVE_ROOT } = await import(GUARD_MODULE);
      expect(MIMER_DEMO_LIVE_ROOT).toBe('D:\\mimer-demo');
      for (const target of [
        'D:\\mimer-demo\\cas\\objects\\ab\\x',
        'D:\\mimer-demo\\secrets\\lu-execution-authority\\root.pem',
        'd:/MIMER-DEMO/secrets/x.pem',
        '\\\\?\\D:\\mimer-demo\\secrets\\x.pem',
      ]) {
        // judged as written: refused before any file-system lookup
        const refusal = testDataRootWriteRefusal('fs.writeFileSync', 'write', target, {
          testFile: null,
          resolveLinks: false,
        });
        expect({ target, root: refusal?.protectedRoot }).toEqual({ target, root: 'D:\\mimer-demo' });
      }
      expect(
        testDataRootWriteRefusal('fs.rmSync', 'remove', 'D:\\', { testFile: null, resolveLinks: false }),
      ).not.toBeNull();
    },
  );

  it('~/.mimers (secrets and every level) is derived from os.homedir() at run time, never a written user name', async () => {
    const { testDataRootWriteRefusal, TEST_PROTECTED_HOME_ROOTS } = await import(GUARD_MODULE);
    const decide = (target: string) =>
      testDataRootWriteRefusal('fs.writeFileSync', 'write', target, { testFile: null, resolveLinks: false });
    // the real home: decided only, as written -- nothing in ~/.mimers is looked at
    expect(decide(path.join(os.homedir(), '.mimers', 'secrets', 'x.pem'))?.protectedRoot).toBe(
      path.join(os.homedir(), '.mimers'),
    );
    // another home directory at run time is protected the same way, and the account's own home stays protected
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg5-home-'));
    try {
      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      expect(decide(path.join(fakeHome, '.mimers', 'secrets', 'k.pem'))).not.toBeNull();
      expect(decide(path.join(fakeHome, '.mimers', 'cas', 'objects'))).not.toBeNull();
      expect(decide(path.join(os.userInfo().homedir, '.mimers', 'secrets', 'k.pem'))).not.toBeNull();
      expect(decide(path.join(fakeHome, 'not-protected', 'x'))).toBeNull();
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
    for (const { root } of TEST_PROTECTED_HOME_ROOTS as Array<{ root: string }>) {
      expect({ root, relative: !path.isAbsolute(root) && !/^[A-Za-z]:/.test(root) }).toEqual({
        root,
        relative: true,
      });
    }
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'server/modules/test-db-guard/installTestDataRootWriteGuard.ts'),
      'utf8',
    );
    const userName = os.userInfo().username;
    expect(source.toLowerCase()).not.toContain(`users\\\\${userName}`.toLowerCase());
    expect(source.toLowerCase()).not.toContain(`users/${userName}`.toLowerCase());
  });

  it.runIf(isWin)(
    "the live trees of this workstation (main checkout, the demonstrator's worktree) are protected from an export too",
    async () => {
      const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
      for (const target of [
        'C:\\wt-lu-demo\\storage\\drafts\\x.docx',
        'C:\\wt-lu-demo\\.quarantine\\x.bin',
        'C:\\miljöbeslut\\.quarantine\\x.bin',
        'C:\\miljöbeslut\\storage\\geo_master_archive\\x',
        'C:\\miljöbeslut\\scripts\\db\\.puh-scale-01-results.jsonl',
      ]) {
        expect({
          target,
          refused: Boolean(
            testDataRootWriteRefusal('fs.writeFileSync', 'write', target, {
              testFile: null,
              resolveLinks: false,
            }),
          ),
        }).toEqual({ target, refused: true });
      }
    },
  );

  it("finding 11: the tree's own root files (.env, .env.local, .env.test, package.json, package-lock.json) are refused, a namesake beside them is not", async () => {
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    const decide = (rel: string) =>
      Boolean(
        testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(fakeTree, rel), {
          trees: [fakeTree],
          testFile: null,
        }),
      );
    const files = ['.env', '.env.local', '.env.test', 'package.json', 'package-lock.json'];
    expect(Object.fromEntries(files.map((rel) => [rel, decide(rel)]))).toEqual(
      Object.fromEntries(files.map((rel) => [rel, true])),
    );
    expect({ example: decide('.env.example'), nested: decide('server/package.json') }).toEqual({
      example: false,
      nested: false,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// TDG-6 (TDG5-VERIFICATION findings 1-5, and the cheap low findings 6, 8, 9, 13): readFile with a write flag
// and EVERY other node:fs function decided, every path type, a link to an ANCESTOR of a root plus a recursive
// copy, the fail-open real path, mkdtempDisposable, the device namespace, .git and the surviving mutations
// N01-N04, N08, N09, N18. Every write still targets a FAKE tree in this test's temp directory.

const GUARD_MARK = Symbol.for('mimer.testDbGuard.dataRootWriteGuard');
/** 70 directory levels: more than the 64 the real-path lookup used to climb before it said "allowed". */
const DEEP = Array.from({ length: 70 }, (_, i) => `l${i}`);

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : String((error as Error)?.message ?? error);
};

/** The 8.3 short form of an existing path, or null when the volume makes none (then the case is skipped). */
function shortPathOf(target: string): string | null {
  if (!isWin) return null;
  const query = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${target}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  });
  const short = String(query.stdout ?? '').trim();
  return short && short.toLowerCase() !== target.toLowerCase() ? short : null;
}

/** 'WROTE' when a stream opened its file (or became ready), else the error code. */
function streamOutcome(make: () => unknown): Promise<string> {
  return new Promise((resolve) => {
    let stream: { once: (event: string, f: (e?: unknown) => void) => void; destroy?: () => void };
    try {
      stream = make() as typeof stream;
    } catch (error) {
      resolve(codeOf(error));
      return;
    }
    const timer = setTimeout(() => resolve('NO_EVENT'), 5_000);
    stream.once('error', (error) => {
      clearTimeout(timer);
      resolve(codeOf(error));
    });
    for (const event of ['open', 'ready'])
      stream.once(event, () => {
        clearTimeout(timer);
        resolve('WROTE');
        stream.destroy?.();
      });
  });
}

describe('TDG-6: readFile and createReadStream with a write flag, the stream classes, mkdtempDisposable (findings 1, 5)', () => {
  let area: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg6-flags-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  for (const style of STYLES) {
    it(`${style}: readFile with flag w, w+, a, a+ or r+ (with and without an encoding) into a root is refused, nothing is created or truncated; flag r still reads`, async () => {
      const tree = path.join(area, `tree-${style}`);
      makeFakeProductTree(tree);
      const live = path.join(tree, 'storage', 'keep', 'live.txt');
      const fresh = path.join(tree, 'storage', 'keep', 'created-by-readfile.txt');
      const before = listing(tree);
      vi.spyOn(process, 'cwd').mockReturnValue(tree);
      const results: Record<string, string> = {};
      for (const flag of ['w', 'w+', 'a', 'a+', 'r+']) {
        results[`${flag}, utf8, the live file`] = await outcomeOf(() =>
          fsCall(style, 'readFile', live, { encoding: 'utf8', flag }),
        );
        results[`${flag}, a new file`] = await outcomeOf(() => fsCall(style, 'readFile', fresh, { flag }));
      }
      results['r, utf8 (a read)'] = await outcomeOf(() =>
        fsCall(style, 'readFile', live, { encoding: 'utf8', flag: 'r' }),
      );
      vi.restoreAllMocks();
      const refusedNames = Object.keys(results).filter((name) => !name.startsWith('r,'));
      expect(results).toEqual({
        ...Object.fromEntries(refusedNames.map((name) => [name, REFUSED])),
        'r, utf8 (a read)': 'WROTE', // succeeded: reading is never refused
      });
      expect(listing(tree)).toEqual(before);
      expect(fs.readFileSync(live, 'utf8')).toBe('live');
    });
  }

  it('createReadStream / new ReadStream with a write flag, new WriteStream, a Utf8Stream, mkdtempDisposableSync and promises.mkdtempDisposable into a root are refused, nothing lands', async () => {
    const tree = path.join(area, 'tree-streams');
    makeFakeProductTree(tree);
    const keep = path.join(tree, 'storage', 'keep');
    const live = path.join(keep, 'live.txt');
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    type Ctor = new (...args: unknown[]) => unknown;
    const anyFs = fs as unknown as Record<string, unknown>;
    const results: Record<string, string> = {
      'createReadStream flags w': await streamOutcome(() => fs.createReadStream(live, { flags: 'w' })),
      'createReadStream flags a+, a new file': await streamOutcome(() =>
        fs.createReadStream(path.join(keep, 'rs-new.txt'), { flags: 'a+' }),
      ),
      'new ReadStream flags w': await streamOutcome(() => new (anyFs.ReadStream as Ctor)(live, { flags: 'w' })),
      'new WriteStream': await streamOutcome(() => new (anyFs.WriteStream as Ctor)(path.join(keep, 'ws.txt'))),
      'new FileWriteStream': await streamOutcome(
        () => new (anyFs.FileWriteStream as Ctor)(path.join(keep, 'fws.txt')),
      ),
      'mkdtempDisposableSync': await outcomeOf(
        async () =>
          (anyFs.mkdtempDisposableSync as (p: string) => unknown)?.(path.join(keep, 'disp-')) ??
          'NOT_IN_THIS_NODE',
      ),
      'promises.mkdtempDisposable': await outcomeOf(async () => {
        const fn = (fs.promises as unknown as Record<string, unknown>).mkdtempDisposable as
          | ((p: string) => Promise<unknown>)
          | undefined;
        return fn ? fn(path.join(keep, 'pdisp-')) : 'NOT_IN_THIS_NODE';
      }),
    };
    if (typeof anyFs.Utf8Stream === 'function') {
      results['new Utf8Stream (sync)'] = await streamOutcome(
        () => new (anyFs.Utf8Stream as Ctor)({ dest: path.join(keep, 'u8.txt'), sync: true }),
      );
      results['new Utf8Stream (async, mkdir)'] = await streamOutcome(
        () => new (anyFs.Utf8Stream as Ctor)({ dest: path.join(keep, 'u8dir', 'u8.txt'), mkdir: true }),
      );
    }
    results['control: createReadStream flag r reads'] = await streamOutcome(() => fs.createReadStream(live));
    vi.restoreAllMocks();
    expect(results).toEqual({
      ...Object.fromEntries(
        Object.keys(results)
          .filter((name) => !name.startsWith('control'))
          .map((name) => [name, REFUSED]),
      ),
      'control: createReadStream flag r reads': 'WROTE', // opened for reading
    });
    expect(listing(tree)).toEqual(before);
    expect(fs.readFileSync(live, 'utf8')).toBe('live');
  });
});

/** Every function of node:fs (and its function properties), node:fs/promises and a FileHandle, by name. */
async function fsFunctionSurfaces(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const add = (prefix: string, holder: object, own: object, nested: boolean) => {
    for (const name of Object.getOwnPropertyNames(own)) {
      let value: unknown;
      try {
        value = (holder as Record<string, unknown>)[name]; // a lazy getter (ReadStream, Utf8Stream ...) included
      } catch {
        continue;
      }
      if (typeof value !== 'function') continue;
      const key = `${prefix}.${name}`;
      if (!(key in out)) out[key] = value;
      if (!nested) continue;
      for (const sub of Object.getOwnPropertyNames(value)) {
        if (['length', 'name', 'prototype', 'caller', 'arguments'].includes(sub)) continue;
        const inner = (value as unknown as Record<string, unknown>)[sub];
        if (typeof inner === 'function') out[`${key}.${sub}`] = inner;
      }
    }
  };
  const noDeprecation = process.noDeprecation;
  process.noDeprecation = true; // fs.F_OK and friends warn when read
  try {
    add('fs', fs, fs, true);
    add('fs.promises', fs.promises, fs.promises, true);
  } finally {
    process.noDeprecation = noDeprecation;
  }
  const probe = path.join(tmpRoot, 'wtdg6-filehandle-probe.txt');
  fs.writeFileSync(probe, 'x');
  const handle = await fs.promises.open(probe, 'r');
  try {
    // the handle's own functions (close) and its class's, up to EventEmitter
    for (let own: object | null = handle; own && own !== EventEmitter.prototype; own = Object.getPrototypeOf(own))
      add('FileHandle', handle, own, false);
  } finally {
    await handle.close();
  }
  return out;
}

describe('TDG-6: every node:fs, node:fs/promises and FileHandle function is guarded or reviewed (finding 1)', () => {
  it('the installed Node has no function that is neither wrapped by the guard nor on the reviewed list -- a new Node API is a decision, never a silent pass', async () => {
    const { TEST_FS_FUNCTIONS_NOT_GUARDED } = await import(GUARD_MODULE);
    const reviewed = TEST_FS_FUNCTIONS_NOT_GUARDED as Readonly<Record<string, string>>;
    expect(reviewed).toBeTypeOf('object');
    const surfaces = await fsFunctionSurfaces();
    const guarded: string[] = [];
    const unclassified: string[] = [];
    const bothGuardedAndReviewed: string[] = [];
    for (const [name, fn] of Object.entries(surfaces)) {
      const isGuarded = (fn as unknown as Record<symbol, unknown>)[GUARD_MARK] === true;
      const isReviewed = Object.prototype.hasOwnProperty.call(reviewed, name);
      if (isGuarded && isReviewed) bothGuardedAndReviewed.push(name);
      else if (isGuarded) guarded.push(name);
      else if (!isReviewed) unclassified.push(name);
    }
    expect({ unclassified, bothGuardedAndReviewed }).toEqual({ unclassified: [], bothGuardedAndReviewed: [] });
    for (const [name, why] of Object.entries(reviewed))
      expect({ name, reasoned: typeof why === 'string' && why.length >= 30 }).toEqual({ name, reasoned: true });
    // not vacuous: the enumeration sees all three surfaces, and the writing functions are wrapped
    expect(Object.keys(surfaces).filter((name) => name.startsWith('FileHandle.'))).toEqual(
      expect.arrayContaining(['FileHandle.close', 'FileHandle.writeFile', 'FileHandle.chmod']),
    );
    expect(guarded).toEqual(
      expect.arrayContaining([
        'fs.writeFileSync',
        'fs.readFile',
        'fs.readFileSync',
        'fs.promises.readFile',
        'fs.createReadStream',
        'fs.cpSync',
        'fs.promises.cp',
        'fs.chownSync',
        'fs.lutimesSync',
        'fs.lchownSync',
        'fs.promises.lchmod',
        ...(typeof (fs as unknown as Record<string, unknown>).mkdtempDisposableSync === 'function'
          ? ['fs.mkdtempDisposableSync', 'fs.promises.mkdtempDisposable']
          : []),
      ]),
    );
  });

  it('the guarded functions and how each argument is judged are locked', async () => {
    const { TEST_DATA_ROOT_GUARDED_FS_CALLS } = await import(GUARD_MODULE);
    expect(TEST_DATA_ROOT_GUARDED_FS_CALLS).toEqual({
      writeFile: ['0:write'],
      appendFile: ['0:write'],
      truncate: ['0:write'],
      readFile: ['0:write if its flag writes'],
      mkdir: ['0:mkdir'],
      mkdtemp: ['0:mkdtemp'],
      mkdtempDisposable: ['0:mkdtemp'],
      copyFile: ['1:write'],
      cp: ['1:tree', '1:tree for every path a recursive copy writes'],
      rename: ['0:remove', '1:tree'],
      link: ['0:write', '1:write'],
      symlink: ['0:write (a relative target also against the link)', '1:tree'],
      rm: ['0:remove'],
      rmdir: ['0:remove'],
      unlink: ['0:remove'],
      open: ['0:write if its flag writes'],
      createWriteStream: ['0:write'],
      createReadStream: ['0:write if its flag writes'],
      utimes: ['0:write'],
      lutimes: ['0:write'],
      chmod: ['0:write'],
      lchmod: ['0:write'],
      chown: ['0:write'],
      lchown: ['0:write'],
    });
  });
});

type PathMaker = (p: string) => unknown;
/** Every path type node:fs accepts, by name (TDG5-VERIFICATION finding 2: a Uint8Array went past every check). */
const PATH_TYPES: Readonly<Record<string, PathMaker>> = {
  string: (p) => p,
  Buffer: (p) => Buffer.from(p),
  Uint8Array: (p) => new Uint8Array(Buffer.from(p)),
  'file: URL': (p) => pathToFileURL(p),
  'URL-like object': (p) => {
    const u = pathToFileURL(p);
    return { href: u.href, protocol: u.protocol, hostname: u.hostname, pathname: u.pathname };
  },
};

describe('TDG-6: every path type reaches the same decision -- string, Buffer, Uint8Array, a file: URL, a URL-like object (finding 2, mutation N01)', () => {
  let area: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg6-types-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  for (const [typeName, T] of Object.entries(PATH_TYPES)) {
    for (const style of ['sync', 'promise'] as const) {
      it(`${typeName}, ${style}: every write function into a root is refused, nothing changes; outside every root it writes`, async () => {
        const slug = `${typeName.replace(/[^A-Za-z0-9]+/g, '-')}-${style}`;
        const tree = path.join(area, `tree-${slug}`);
        const outside = path.join(area, `outside-${slug}`);
        makeFakeProductTree(tree);
        fs.mkdirSync(outside, { recursive: true });
        const file = path.join(outside, 'file.txt');
        fs.writeFileSync(file, 'outside');
        const keep = path.join(tree, 'storage', 'keep');
        const live = path.join(keep, 'live.txt');
        linkPathsToRemove.push(path.join(outside, 'alias'), path.join(keep, 'link'), path.join(outside, 'hard.txt'));
        linkPathsToRemove.push(path.join(keep, 'hard.txt'));
        const treeBefore = listing(tree);
        const outsideBefore = listing(outside);
        vi.spyOn(process, 'cwd').mockReturnValue(tree);
        const promises = fs.promises as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const disposable = (prefix: unknown) =>
          style === 'sync'
            ? Promise.resolve().then(() =>
                (fs as unknown as Record<string, (p: unknown) => unknown>).mkdtempDisposableSync(prefix),
              )
            : promises.mkdtempDisposable(prefix);
        const attempts: Record<string, () => Promise<unknown>> = {
          writeFile: () => fsCall(style, 'writeFile', T(path.join(keep, 'w.txt')), 'x'),
          appendFile: () => fsCall(style, 'appendFile', T(live), 'x'),
          truncate: () => fsCall(style, 'truncate', T(live), 0),
          'readFile with flag w': () => fsCall(style, 'readFile', T(path.join(keep, 'r.txt')), { flag: 'w' }),
          mkdir: () => fsCall(style, 'mkdir', T(path.join(keep, 'd')), { recursive: true }),
          mkdtemp: () => fsCall(style, 'mkdtemp', T(path.join(keep, 't-'))),
          ...(typeof (fs as unknown as Record<string, unknown>).mkdtempDisposableSync === 'function'
            ? { mkdtempDisposable: () => disposable(T(path.join(keep, 'td-'))) }
            : {}),
          copyFile: () => fsCall(style, 'copyFile', file, T(path.join(keep, 'c.txt'))),
          cp: () => fsCall(style, 'cp', file, T(path.join(keep, 'cp.txt')), {}),
          'rename a live file out': () => fsCall(style, 'rename', T(live), path.join(outside, 'stolen.txt')),
          'rename into storage': () => fsCall(style, 'rename', file, T(path.join(keep, 'm.txt'))),
          'link a live file out': () => fsCall(style, 'link', T(live), path.join(outside, 'hard.txt')),
          'link into storage': () => fsCall(style, 'link', file, T(path.join(keep, 'hard.txt'))),
          'open r+': () => fsCall(style, 'open', T(live), 'r+'),
          utimes: () => fsCall(style, 'utimes', T(live), new Date(0), new Date(0)),
          lutimes: () => fsCall(style, 'lutimes', T(live), new Date(0), new Date(0)),
          chmod: () => fsCall(style, 'chmod', T(live), 0o444),
          chown: () => fsCall(style, 'chown', T(live), 0, 0),
          lchown: () => fsCall(style, 'lchown', T(live), 0, 0),
          ...(style === 'sync'
            ? {
                createWriteStream: () =>
                  streamOutcome(() => fs.createWriteStream(T(path.join(keep, 's.txt')) as string)).then((o) => {
                    if (o !== 'WROTE') throw Object.assign(new Error(o), { code: o });
                  }),
              }
            : {}),
          unlink: () => fsCall(style, 'unlink', T(live)),
          rmdir: () => fsCall(style, 'rmdir', T(keep)),
          rm: () => fsCall(style, 'rm', T(keep), { recursive: true, force: true }),
          // the links last: a broken guard never leaves a link inside a directory a later attempt removes
          'symlink INTO storage': () => fsCall(style, 'symlink', T(keep), path.join(outside, 'alias'), 'junction'),
          'symlink placed in storage': () =>
            fsCall(style, 'symlink', outside, T(path.join(keep, 'link')), 'junction'),
        };
        const results: Record<string, string> = {};
        for (const [name, run] of Object.entries(attempts)) results[name] = await outcomeOf(run);
        vi.restoreAllMocks();
        expect(results).toEqual(Object.fromEntries(Object.keys(attempts).map((name) => [name, REFUSED])));
        expect(listing(tree)).toEqual(treeBefore);
        expect(listing(outside)).toEqual(outsideBefore);
        expect(fs.readFileSync(live, 'utf8')).toBe('live');
        // not a blanket refusal: the same type outside every root writes exactly there
        const ok = path.join(outside, `ok-${slug}.txt`);
        expect(await outcomeOf(() => fsCall(style, 'writeFile', T(ok), 'ok'))).toBe('WROTE');
        expect(fs.readFileSync(ok, 'utf8')).toBe('ok');
      });
    }
  }

  it('a byte view that is not a Uint8Array (Node rejects it as a path) into a root is refused by the guard as well', async () => {
    const tree = path.join(area, 'tree-views');
    makeFakeProductTree(tree);
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const target = Buffer.from(path.join(tree, 'storage', 'keep', 'v.txt'));
    const outcome = await outcomeOf(() =>
      fsCall('sync', 'writeFile', new Uint8ClampedArray(target.buffer, target.byteOffset, target.byteLength), 'x'),
    );
    vi.restoreAllMocks();
    expect(outcome).toBe(REFUSED);
    expect(listing(tree)).toEqual(before);
  });

  it('a URL-like object whose href and hostname/pathname name different paths is refused (both ways); one whose getters change is judged once and written as judged', async () => {
    const tree = path.join(area, 'tree-urllike');
    const outside = path.join(area, 'outside-urllike');
    makeFakeProductTree(tree);
    fs.mkdirSync(outside, { recursive: true });
    const inRoot = pathToFileURL(path.join(tree, 'storage', 'keep', 'u.txt'));
    const out = pathToFileURL(path.join(outside, 'u.txt'));
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const mixed = (href: URL, at: URL) => ({
      href: href.href,
      protocol: 'file:',
      hostname: at.hostname,
      pathname: at.pathname,
    });
    let reads = 0;
    const shifting = {
      href: out.href,
      protocol: 'file:',
      hostname: '',
      get pathname() {
        reads += 1;
        return reads <= 1 ? out.pathname : inRoot.pathname; // the outside path first, the root afterwards
      },
    };
    const results = {
      'href outside, pathname in a root': await outcomeOf(() =>
        fsCall('sync', 'writeFile', mixed(out, inRoot), 'x'),
      ),
      'href in a root, pathname outside': await outcomeOf(() =>
        fsCall('sync', 'writeFile', mixed(inRoot, out), 'x'),
      ),
      'getters that change after the decision': await outcomeOf(() => fsCall('sync', 'writeFile', shifting, 'x')),
    };
    vi.restoreAllMocks();
    expect(results).toEqual({
      'href outside, pathname in a root': REFUSED,
      'href in a root, pathname outside': REFUSED,
      'getters that change after the decision': 'WROTE',
    });
    expect(listing(tree)).toEqual(before);
    expect(fs.existsSync(path.join(outside, 'u.txt'))).toBe(true); // written where it was judged
  });
});

describe('TDG-6: a link to an ANCESTOR of a root may exist, but no copy writes through it (finding 3)', () => {
  let area: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg6-ancestor-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  it('a junction to the tree root (as scripts/audit/devgovPathBranchLock.test.ts:73 makes one to process.cwd()) and to tests/ is allowed; cpSync, fs.cp and promises.cp of a bundle into the link\'s parent are refused, nothing lands', async () => {
    const tree = path.join(area, 'tree');
    const outside = path.join(area, 'outside');
    const bundle = path.join(area, 'bundle');
    const plainBundle = path.join(area, 'plain-bundle');
    makeFakeProductTree(tree);
    // the links' targets exist (Node 24.15's cpSync took the whole process down on a DANGLING junction in the
    // destination: a worker exit, not a refusal -- seen in the first RED run of this test)
    fs.mkdirSync(path.join(tree, 'tests', 'fixtures'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(path.join(bundle, 'j-tree', 'storage', 'keep'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'j-tree', 'storage', 'keep', 'planted.pem'), 'planted');
    fs.mkdirSync(path.join(bundle, 'j-tests', 'fixtures'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'j-tests', 'fixtures', 'planted.txt'), 'planted');
    fs.mkdirSync(path.join(plainBundle, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(plainBundle, 'sub', 'ok.txt'), 'ok');
    const jTree = path.join(outside, 'j-tree');
    const jTests = path.join(outside, 'j-tests');
    linkPathsToRemove.push(jTree, jTests);
    const treeBefore = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const results: Record<string, string> = {
      'symlink (junction) to the tree root': await outcomeOf(() =>
        fsCall('sync', 'symlink', tree, jTree, isWin ? 'junction' : 'dir'),
      ),
      'symlink (junction) to tests/, an ancestor of tests/fixtures': await outcomeOf(() =>
        fsCall('sync', 'symlink', path.join(tree, 'tests'), jTests, isWin ? 'junction' : 'dir'),
      ),
    };
    for (const style of STYLES)
      results[`${style}: cp the bundle into the link's parent (recursive)`] = await outcomeOf(() =>
        fsCall(style, 'cp', bundle, outside, { recursive: true }),
      );
    results['control: cp a bundle without such paths into the same parent'] = await outcomeOf(() =>
      fsCall('sync', 'cp', plainBundle, outside, { recursive: true }),
    );
    vi.restoreAllMocks();
    expect(results).toEqual({
      'symlink (junction) to the tree root': 'WROTE',
      'symlink (junction) to tests/, an ancestor of tests/fixtures': 'WROTE',
      "sync: cp the bundle into the link's parent (recursive)": REFUSED,
      "callback: cp the bundle into the link's parent (recursive)": REFUSED,
      "promise: cp the bundle into the link's parent (recursive)": REFUSED,
      'control: cp a bundle without such paths into the same parent': 'WROTE',
    });
    expect(listing(tree)).toEqual(treeBefore);
    expect(fs.existsSync(path.join(outside, 'sub', 'ok.txt'))).toBe(true);
  });

  it('decided: a recursive copy is refused for the destination path of every entry it would write, a link target that is the tree root is not', async () => {
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    const tree = path.join(area, 'tree-decide');
    makeFakeProductTree(tree);
    expect(
      testDataRootWriteRefusal('fs.symlinkSync', 'write', tree, { trees: [tree], testFile: null }),
    ).toBeNull();
    expect(
      testDataRootWriteRefusal('fs.cpSync', 'tree', path.join(tree, 'storage'), { trees: [tree], testFile: null }),
    ).not.toBeNull();
  });
});

describe('TDG-6: the real path is fail-closed and compared in its long form (finding 4, mutation N18)', () => {
  let area: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg6-realpath-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  it('70 missing levels under a junction to the tree: mkdir (recursive) and cpSync are refused, nothing lands', async () => {
    const tree = path.join(area, 'tree-junction');
    const outside = path.join(area, 'outside-junction');
    makeFakeProductTree(tree);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'src.txt'), 'x');
    const link = path.join(outside, 'j');
    linkPathsToRemove.push(link);
    fs.symlinkSync(tree, link, isWin ? 'junction' : 'dir'); // made before the tree is protected
    const deep = path.join(link, 'storage', 'keep', ...DEEP);
    const before = listing(tree);
    vi.spyOn(process, 'cwd').mockReturnValue(tree);
    const results = {
      mkdir: await outcomeOf(() => fsCall('sync', 'mkdir', deep, { recursive: true })),
      cpSync: await outcomeOf(() => fsCall('sync', 'cp', path.join(outside, 'src.txt'), path.join(deep, 'x.txt'), {})),
      'promises.mkdir': await outcomeOf(() => fsCall('promise', 'mkdir', deep, { recursive: true })),
    };
    vi.restoreAllMocks();
    expect(results).toEqual({ mkdir: REFUSED, cpSync: REFUSED, 'promises.mkdir': REFUSED });
    expect(listing(tree)).toEqual(before);
  });

  it.runIf(isWin)(
    "70 missing levels under an 8.3 alias of the tree's parent -- no link at all: mkdir (recursive) and cpSync are refused, nothing lands",
    async (ctx) => {
      const parent = path.join(area, 'long-parent-name-for-83');
      const tree = path.join(parent, 'tree');
      makeFakeProductTree(tree);
      fs.writeFileSync(path.join(area, 'src83.txt'), 'x');
      const shortParent = shortPathOf(parent);
      if (!shortParent) ctx.skip(); // no 8.3 names on this volume
      const deep = path.join(shortParent as string, 'tree', 'storage', 'keep', ...DEEP);
      const before = listing(tree);
      vi.spyOn(process, 'cwd').mockReturnValue(tree);
      const results = {
        mkdir: await outcomeOf(() => fsCall('sync', 'mkdir', deep, { recursive: true })),
        cpSync: await outcomeOf(() =>
          fsCall('sync', 'cp', path.join(area, 'src83.txt'), path.join(deep, 'x.txt'), {}),
        ),
      };
      vi.restoreAllMocks();
      expect(results).toEqual({ mkdir: REFUSED, cpSync: REFUSED });
      expect(listing(tree)).toEqual(before);
    },
  );

  it('a chain of more links than the guard follows is undecidable: refused even outside every root (fail-closed), nothing is written', async () => {
    const tree = path.join(area, 'tree-chain');
    const outside = path.join(area, 'outside-chain');
    makeFakeProductTree(tree);
    fs.mkdirSync(outside, { recursive: true });
    // j0 -> j1 -> ... -> j39 -> (missing), made from the front (each target does not exist yet, so each link
    // is decidable when it is made) and removed from the end afterwards (each removal stays decidable)
    const links = Array.from({ length: 40 }, (_, i) => path.join(outside, `j${i}`));
    for (let i = 0; i < links.length; i += 1)
      fs.symlinkSync(
        i === links.length - 1 ? path.join(outside, 'missing') : links[i + 1],
        links[i],
        isWin ? 'junction' : 'dir',
      );
    linkPathsToRemove.push(...[...links].reverse());
    const outsideBefore = listing(outside);
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    const refusal = testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(links[0], 'x.txt'), {
      trees: [tree],
      testFile: null,
    });
    const written = await outcomeOf(() => fsCall('sync', 'writeFile', path.join(links[0], 'x.txt'), 'x'));
    expect({ refused: Boolean(refusal), written }).toEqual({ refused: true, written: REFUSED });
    expect(String(refusal?.undecidable ?? '')).not.toBe('');
    expect(listing(outside)).toEqual(outsideBefore);
    // decidable again once the chain is short: the last links are no target of any root
    expect(
      testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(links[30], 'x.txt'), {
        trees: [tree],
        testFile: null,
      }),
    ).toBeNull();
  });

  it.runIf(isWin)('a volume that does not exist is no target: nothing can land there, it is not refused', async () => {
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    const free = 'QWXYZRSTUVJKLNOP'.split('').find((letter) => !fs.existsSync(`${letter}:\\`));
    expect(free).toBeDefined();
    expect(
      testDataRootWriteRefusal('fs.writeFileSync', 'write', `${free}:\\wtdg6\\x.txt`, { trees: [fakeTree], testFile: null }),
    ).toBeNull();
  });

  it('N18: a tree given through a junction protects its real path as written, without the real-path pass', async () => {
    const tree = path.join(area, 'tree-n18');
    makeFakeProductTree(tree);
    const alias = path.join(area, 'alias-n18');
    linkPathsToRemove.push(alias);
    fs.symlinkSync(tree, alias, isWin ? 'junction' : 'dir');
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    const refusal = testDataRootWriteRefusal('fs.writeFileSync', 'write', path.join(tree, 'storage', 'x.txt'), {
      trees: [alias],
      testFile: null,
      resolveLinks: false,
    });
    expect(String(refusal?.protectedRoot).toLowerCase()).toBe(path.join(tree, 'storage').toLowerCase());
  });

  it.runIf(isWin)(
    'a protected home root given by an 8.3 short name still protects the long form of ~/.mimers (roots are compared by their real path too)',
    async (ctx) => {
      const fakeHome = path.join(area, 'long-fake-home-directory');
      fs.mkdirSync(fakeHome, { recursive: true });
      const shortHome = shortPathOf(fakeHome);
      if (!shortHome) ctx.skip();
      const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
      vi.spyOn(os, 'homedir').mockReturnValue(shortHome as string);
      const refusal = testDataRootWriteRefusal(
        'fs.writeFileSync',
        'write',
        path.join(fakeHome, '.mimers', 'secrets', 'k.pem'),
        { trees: [fakeTree], testFile: null },
      );
      vi.restoreAllMocks();
      expect(refusal).not.toBeNull();
    },
  );
});

describe('TDG-6: device-namespace forms, other names of this machine, forward slashes, .git (findings 8, 9, 13; mutations N02-N04)', () => {
  let area: string;
  let tree: string;

  beforeAll(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg6-forms-'));
    tree = path.join(area, 'tree');
    makeFakeProductTree(tree);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    removeLinksThenTree(area);
  });

  const decideAsWritten = async (target: string, kind = 'write') => {
    const { testDataRootWriteRefusal } = await import(GUARD_MODULE);
    return testDataRootWriteRefusal('fs.writeFileSync', kind, target, {
      trees: [tree],
      testFile: null,
      resolveLinks: false,
    });
  };

  it.runIf(isWin)(
    '\\\\?\\GLOBALROOT, \\\\?\\Volume{GUID} and every device-namespace form that names no drive and no UNC share are refused -- also outside every root',
    async () => {
      const inStorage = path.join(tree, 'storage', 'keep', 'x.txt');
      const outsideFile = path.join(area, 'outside', 'x.txt');
      const forms = {
        globalRootInRoot: `\\\\?\\GLOBALROOT\\GLOBAL??\\${inStorage}`,
        globalRootOutside: `\\\\?\\GLOBALROOT\\GLOBAL??\\${outsideFile}`,
        globalRootDevice: `\\\\.\\GLOBALROOT\\GLOBAL??\\${outsideFile}`,
        globalRootForwardSlashes: `//?/GLOBALROOT/GLOBAL??/${outsideFile.replace(/\\/g, '/')}`,
        volumeGuid: `\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\${outsideFile.slice(3)}`,
        harddiskVolume: `\\\\?\\HarddiskVolume3\\${outsideFile.slice(3)}`,
      };
      const decided: Record<string, boolean> = {};
      for (const [name, target] of Object.entries(forms)) decided[name] = Boolean(await decideAsWritten(target));
      expect(decided).toEqual(Object.fromEntries(Object.keys(forms).map((name) => [name, true])));
      // a drive or a UNC share in the same namespace is judged as the path it names
      expect(await decideAsWritten(`\\\\?\\${outsideFile}`)).toBeNull();
      expect(await decideAsWritten(`\\\\?\\UNC\\localhost\\${outsideFile[0]}$\\${outsideFile.slice(3)}`)).toBeNull();
    },
  );

  it.runIf(isWin)(
    'written for real: \\\\?\\GLOBALROOT\\GLOBAL??\\<tree>\\storage\\... is refused, nothing lands (TDG5-VERIFICATION B12)',
    async () => {
      const before = listing(tree);
      vi.spyOn(process, 'cwd').mockReturnValue(tree);
      const outcome = await outcomeOf(() =>
        fsCall('sync', 'writeFile', `\\\\?\\GLOBALROOT\\GLOBAL??\\${path.join(tree, 'storage', 'keep', 'g.txt')}`, 'x'),
      );
      vi.restoreAllMocks();
      expect(outcome).toBe(REFUSED);
      expect(listing(tree)).toEqual(before);
    },
  );

  it.runIf(isWin)(
    "N02-N04: this machine's own name, any 127.x.x.x and the forward-slash spellings of \\\\?\\, \\\\.\\ and an administrative share are the root, as written",
    async () => {
      const inStorage = path.join(tree, 'storage', 'keep', 'x.txt');
      const drive = inStorage.slice(0, 1);
      const rest = inStorage.slice(3);
      const forms = {
        hostname: `\\\\${os.hostname()}\\${drive}$\\${rest}`,
        hostnameUpper: `\\\\${os.hostname().toUpperCase()}\\${drive.toLowerCase()}$\\${rest}`,
        loopback2: `\\\\127.0.0.2\\${drive}$\\${rest}`,
        loopbackHigh: `\\\\127.255.255.254\\${drive}$\\${rest}`,
        forwardWin32File: `//?/${inStorage.replace(/\\/g, '/')}`,
        forwardWin32Device: `//./${inStorage.replace(/\\/g, '/')}`,
        forwardAdminShare: `//localhost/${drive}$/${rest.replace(/\\/g, '/')}`,
        forwardUncLong: `//?/UNC/localhost/${drive}$/${rest.replace(/\\/g, '/')}`,
      };
      const decided: Record<string, boolean> = {};
      for (const [name, target] of Object.entries(forms)) decided[name] = Boolean(await decideAsWritten(target));
      expect(decided).toEqual(Object.fromEntries(Object.keys(forms).map((name) => [name, true])));
      // another machine's share is not this drive
      expect(await decideAsWritten(`\\\\128.0.0.1\\${drive}$\\${rest}`)).toBeNull();
    },
  );

  it("finding 13: the tree's .git (a directory, or a worktree's gitdir file) is protected; .gitignore and .github beside it are not", async () => {
    const decided = async (rel: string) => Boolean(await decideAsWritten(path.join(tree, rel)));
    expect({
      gitConfig: await decided('.git/config'),
      gitHook: await decided('.git/hooks/pre-commit'),
      gitFile: await decided('.git'),
      gitRemoved: Boolean(await decideAsWritten(path.join(tree, '.git'), 'remove')),
      gitignore: await decided('.gitignore'),
      github: await decided('.github/workflows/x.yml'),
    }).toEqual({
      gitConfig: true,
      gitHook: true,
      gitFile: true,
      gitRemoved: true,
      gitignore: false,
      github: false,
    });
  });

  for (const style of STYLES) {
    it(`N08/N09, ${style}: chown, lchown, lutimes (and lchmod where Node has it) of a live file are refused`, async () => {
      const local = path.join(area, `tree-meta-${style}`);
      makeFakeProductTree(local);
      const live = path.join(local, 'storage', 'keep', 'live.txt');
      const before = listing(local);
      vi.spyOn(process, 'cwd').mockReturnValue(local);
      const results: Record<string, string> = {
        chown: await outcomeOf(() => fsCall(style, 'chown', live, 0, 0)),
        lchown: await outcomeOf(() => fsCall(style, 'lchown', live, 0, 0)),
        lutimes: await outcomeOf(() => fsCall(style, 'lutimes', live, new Date(0), new Date(0))),
      };
      const lchmodHere =
        style === 'promise'
          ? typeof (fs.promises as unknown as Record<string, unknown>).lchmod === 'function'
          : typeof (fs as unknown as Record<string, unknown>)[style === 'sync' ? 'lchmodSync' : 'lchmod'] === 'function';
      if (lchmodHere) results.lchmod = await outcomeOf(() => fsCall(style, 'lchmod', live, 0o444));
      vi.restoreAllMocks();
      expect(results).toEqual(Object.fromEntries(Object.keys(results).map((name) => [name, REFUSED])));
      expect(listing(local)).toEqual(before);
    });
  }
});
