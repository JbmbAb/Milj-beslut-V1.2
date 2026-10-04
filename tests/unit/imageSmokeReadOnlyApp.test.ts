// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * W-U42C, owner decision ÄF-U42C-1 (2026-10-04): the image smoke's N1 must test the same property -- an
 * @miljobeslut package that only tsconfig-paths resolve cannot be linked without its paths row -- WITHOUT a writable
 * /app. The delivered runtime is root-owned and not writable by appuser (W-U42C IN-5), and the smoke runs as the
 * image's USER appuser; running it as root (`--user 0`) is refused by the owner because it would bypass exactly the
 * property under test (a non-root product against a read-only application tree).
 *
 *  - N1 writes its tsconfig copies in the smoke's own TMP (/tmp/image-smoke-*), never next to /app/tsconfig.json;
 *  - `paths` values resolve against the directory of the tsconfig that declares them, so a copy outside /app has
 *    every value made absolute against the original's directory;
 *  - a relocated copy that resolves WRONGLY fails with the same "Cannot find module '<specifier>'" as the intended red
 *    (shown below with the real tsx), so N1 counts as PASS only when the copy WITH all paths links as well (control).
 *
 * The premise test runs the real tsx (node --import tsx) over a small tree in a temporary directory; no Docker, no
 * network, no database. The smoke itself runs in the image (deploy/onprem/smoke-image.sh, the Docker-bound proof).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SMOKE = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'onprem', 'image-smoke', 'smoke.mjs'), 'utf8').replace(/\r\n/g, '\n');
const N1 = (() => {
  const start = SMOKE.indexOf('// ---------------------------------------------------------------- N1 ');
  const end = SMOKE.indexOf('// Varje tsconfig-paths-only-paket', start);
  return start >= 0 && end > start ? SMOKE.slice(start, end) : '';
})();

const tempDirs: string[] = [];
function tmp(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `u42c-smoke-${label}-`));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('image smoke N1 on a read-only /app (W-U42C, ÄF-U42C-1)', () => {
  it('the N1 block is found (the pins cannot pass vacuously)', () => {
    expect(N1.length, 'smoke.mjs has the N1 section').toBeGreaterThan(500);
    expect(N1).toMatch(/linkOnly\(agg, \{ TSX_TSCONFIG_PATH: /);
  });

  it('N1 writes nothing next to the delivered tsconfig.json or anywhere under /app: every file it writes lies in TMP', () => {
    expect(N1, 'no copy is placed in the directory of /app/tsconfig.json').not.toMatch(/path\.dirname\(TSCONFIG\)\s*,\s*`/);
    const writes = [...N1.matchAll(/fs\.(writeFileSync|appendFileSync|mkdirSync|copyFileSync|renameSync)\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[2]);
    expect(writes.length, 'N1 writes its tsconfig copies').toBeGreaterThan(0);
    for (const v of writes) {
      const decl = new RegExp(`const ${v.replace(/\$/g, '\\$')} = path\\.join\\(TMP, `);
      expect(decl.test(N1), `N1 writes ${v}, which must be path.join(TMP, ...)`).toBe(true);
    }
  });

  it('every paths value of the copy is made absolute against the original tsconfig\'s directory', () => {
    expect(N1).toMatch(/path\.resolve\(path\.dirname\(TSCONFIG\), /);
  });

  it('N1 is PASS only when the copy WITH all paths links (control), the copy without the row does not, and the original does', () => {
    const verdict = /const verdict = ([^\n]+);/.exec(N1)?.[1] ?? '';
    expect(verdict).toMatch(/redSignature/);
    expect(verdict, 'the copy control is part of the verdict').toMatch(/\bcopy\.linked\b/);
    expect(verdict).toMatch(/\bgreen\.linked\b/);
  });
});

describe('premise, with the real tsx: what a tsconfig copy outside the original\'s directory resolves', () => {
  function project() {
    const app = tmp('app');
    const elsewhere = tmp('tmp');
    const files: Record<string, string> = {
      'packages/a/src/index.ts': "export const a = 'A';\n",
      'packages/b/src/index.ts': "export const b = 'B';\n",
      'entry.ts': "import { a } from '@m/a';\nimport { b } from '@m/b';\nconsole.log('LINKED', a, b);\n",
    };
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
      fs.writeFileSync(path.join(app, rel), text);
    }
    const tsconfig = {
      compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true, paths: { '@m/a': ['./packages/a/src/index.ts'], '@m/b': ['./packages/b/src/index.ts'], '~/*': ['./*'] } },
      exclude: ['node_modules'],
    };
    const original = path.join(app, 'tsconfig.json');
    fs.writeFileSync(original, JSON.stringify(tsconfig, null, 2));
    return { app, elsewhere, tsconfig, original };
  }
  // cwd = the repository root: `--import tsx` resolves the repository's own tsx, as in the image (cwd /app)
  const link = (entry: string, tsconfigPath: string) =>
    spawnSync(process.execPath, ['--import', 'tsx', entry], { cwd: REPO_ROOT, env: { ...process.env, TSX_TSCONFIG_PATH: tsconfigPath }, encoding: 'utf8', timeout: 120000 });

  it('original links; an anchored copy elsewhere links; without the @m/a row it does not; a naive copy fails with the SAME signature', () => {
    const { app, elsewhere, tsconfig, original } = project();
    const entry = path.join(app, 'entry.ts');
    const write = (name: string, value: unknown) => {
      const p = path.join(elsewhere, name);
      fs.writeFileSync(p, JSON.stringify(value, null, 2));
      return p;
    };
    const anchored = JSON.parse(JSON.stringify(tsconfig));
    for (const k of Object.keys(anchored.compilerOptions.paths)) anchored.compilerOptions.paths[k] = anchored.compilerOptions.paths[k].map((v: string) => path.resolve(path.dirname(original), v));
    const without = JSON.parse(JSON.stringify(anchored));
    delete without.compilerOptions.paths['@m/a'];

    const okOriginal = link(entry, original);
    expect(okOriginal.stdout + okOriginal.stderr, 'the original links').toMatch(/LINKED A B/);
    const okCopy = link(entry, write('copy.json', anchored));
    expect(okCopy.stdout + okCopy.stderr, 'the anchored copy outside the original\'s directory links like the original').toMatch(/LINKED A B/);
    const red = link(entry, write('without-a.json', without));
    expect(red.status).not.toBe(0);
    expect(red.stderr).toMatch(/Cannot find module '@m\/a'|ERR_MODULE_NOT_FOUND[\s\S]*@m\/a/);
    const naive = link(entry, write('naive.json', tsconfig));
    expect(naive.status, 'a relocated copy with relative paths does not resolve').not.toBe(0);
    expect(naive.stderr, 'and fails with the intended red\'s signature -- hence the copy control').toMatch(/Cannot find module '@m\/a'|ERR_MODULE_NOT_FOUND[\s\S]*@m\/a/);
  });
});
