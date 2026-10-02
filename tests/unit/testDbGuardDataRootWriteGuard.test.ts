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
