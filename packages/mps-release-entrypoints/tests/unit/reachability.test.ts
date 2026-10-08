import { describe, expect, it } from 'vitest';
import { censusTree, computeClosure, memoryTreeReader, parseModule } from '../../src/index';
import type { TreeReader } from '../../src/index';

const TSCONFIG = JSON.stringify({
  // comments are allowed in tsconfig
  compilerOptions: { paths: { '@lib/*': ['./lib/*'], '@exact': ['./lib/exact.ts'], '@miljobeslut/pkg-a': ['./packages/pkg-a/src/index.ts'], '@miljobeslut/pkg-a/*': ['./packages/pkg-a/*'] } },
});

function tree(files: Record<string, string>, withConfig = true): TreeReader {
  return memoryTreeReader({ ...(withConfig ? { 'tsconfig.json': TSCONFIG } : {}), ...files });
}

const kinds = (files: Record<string, string>, extra?: { withConfig?: boolean; roots?: string[] }): string[] =>
  [...new Set(computeClosure(tree(files, extra?.withConfig ?? true), extra?.roots ?? ['root.ts']).unresolved.map((u) => u.kind))].sort();

describe('followed edges', () => {
  const files = {
    'root.ts': [
      "import './side';",
      "import { a } from './a.js';",
      "export * from './re';",
      "import eq = require('./eq');",
      "const lazy = () => import('./lazy');",
      "const c = require('./cjs.cjs');",
      "import { b } from '@lib/b';",
      "import exact from '@exact';",
      "import pa from '@miljobeslut/pkg-a';",
      "import deep from '@miljobeslut/pkg-a/src/deep';",
      "import dir from './folder';",
      "import data from './data.json';",
      "import fs from 'node:fs';",
      "import express from 'express';",
      "import scoped from '@scope/thing/sub';",
    ].join('\n'),
    'side.ts': '', 'a.ts': '', 're.ts': '', 'eq.ts': '', 'lazy.ts': '', 'cjs.cjs': '', 'lib/b.ts': '', 'lib/exact.ts': '', 'data.json': '{}',
    'packages/pkg-a/src/index.ts': '', 'packages/pkg-a/src/deep.ts': '', 'folder/index.ts': '',
  };
  const result = computeClosure(tree(files), ['root.ts']);
  it('follows static, re-export, equals, literal dynamic, require, alias and workspace edges; extension .js maps to .ts; directory index', () => {
    expect(result.union_all).toEqual(Object.keys(files).filter((f) => f !== 'tsconfig.json').sort());
    expect(result.unresolved).toEqual([]);
  });
  it('lists third-party names as external instead of silently dropping them', () => {
    expect(result.external_packages).toEqual(['@scope/thing', 'express', 'node:fs']);
  });
  it('closure is per root and the union is the union', () => {
    const r = computeClosure(tree({ 'x.ts': "import './shared';", 'y.ts': "import './shared';\nimport './only-y';", 'shared.ts': '', 'only-y.ts': '' }), ['y.ts', 'x.ts']);
    expect(r.per_root.map((p) => [p.root, p.files_all])).toEqual([['x.ts', ['shared.ts', 'x.ts']], ['y.ts', ['only-y.ts', 'shared.ts', 'y.ts']]]);
    expect(r.union_all).toEqual(['only-y.ts', 'shared.ts', 'x.ts', 'y.ts']);
  });
  it('type-only edges are in the conservative closure but not in the value closure', () => {
    const r = computeClosure(tree({ 'root.ts': "import type { T } from './t';\nimport { type U } from './u';\nimport { v } from './v';\nexport type { W } from './w';", 't.ts': '', 'u.ts': '', 'v.ts': '', 'w.ts': '' }), ['root.ts']);
    expect(r.union_all).toEqual(['root.ts', 't.ts', 'u.ts', 'v.ts', 'w.ts']);
    expect(r.union_value).toEqual(['root.ts', 'v.ts']);
  });
  it('a workspace package without a path alias resolves through its package.json (exports map and main)', () => {
    const r = computeClosure(
      tree({
        'root.ts': "import a from '@miljobeslut/ws-exports';\nimport b from '@miljobeslut/ws-exports/sub/x';\nimport c from '@miljobeslut/ws-main';",
        'packages/ws-exports/package.json': JSON.stringify({ name: '@miljobeslut/ws-exports', exports: { '.': './src/index.ts', './sub/*': './lib/*.ts' } }),
        'packages/ws-exports/src/index.ts': '', 'packages/ws-exports/lib/x.ts': '',
        'packages/ws-main/package.json': JSON.stringify({ name: '@miljobeslut/ws-main', main: './src/main.ts' }),
        'packages/ws-main/src/main.ts': '',
      }),
      ['root.ts'],
    );
    expect(r.unresolved).toEqual([]);
    expect(r.union_all).toEqual(['packages/ws-exports/lib/x.ts', 'packages/ws-exports/src/index.ts', 'packages/ws-main/src/main.ts', 'root.ts']);
  });
});

describe('createRequire(import.meta.url)(literal) is a require relative to the file', () => {
  it('follows a relative literal and lists a bare literal as external, with no computed-resolution blocker', () => {
    const r = computeClosure(tree({ 'root.ts': "import { createRequire } from 'node:module';\nconst a = createRequire(import.meta.url)('./x');\nconst b = createRequire(import.meta.url)('pg');", 'x.ts': '' }), ['root.ts']);
    expect(r.unresolved).toEqual([]);
    expect(r.union_all).toEqual(['root.ts', 'x.ts']);
    expect(r.external_packages).toEqual(['node:module', 'pg']);
  });
});

describe('FAIL CLOSED: every form the resolver cannot classify is an unresolved blocker', () => {
  const cases: Array<[string, Record<string, string>, string, { withConfig?: boolean; roots?: string[] }?]> = [
    ['a non-literal import()', { 'root.ts': 'const m = "./x"; import(m);' }, 'nonliteral-dynamic-import'],
    ['an import() of a template with a substitution', { 'root.ts': 'import(`./x/${name}`);' }, 'nonliteral-dynamic-import'],
    ['a non-literal require()', { 'root.ts': 'require(name);' }, 'nonliteral-require'],
    ['a require.call with no argument', { 'root.ts': 'require();' }, 'nonliteral-require'],
    ['a stored createRequire instance', { 'root.ts': "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr('./x');" }, 'computed-resolution'],
    ['createRequire with another base', { 'root.ts': "import { createRequire } from 'node:module';\ncreateRequire(base)('./x');" }, 'computed-resolution'],
    ['createRequire(import.meta.url) with a non-literal argument', { 'root.ts': "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)(name);" }, 'nonliteral-require'],
    ['createRequire(import.meta.url) of a relative file that is missing', { 'root.ts': "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('./nope');" }, 'unresolved-relative'],
    ['import.meta.glob', { 'root.ts': "import.meta.glob('./x/*.ts');" }, 'computed-resolution'],
    ['a relative specifier that resolves to no file', { 'root.ts': "import './nope';" }, 'unresolved-relative'],
    ['a relative specifier that climbs out of the tree', { 'root.ts': "import '../../outside';" }, 'unresolved-relative'],
    ['a path alias that matches a pattern but no file', { 'root.ts': "import '@lib/missing';" }, 'unresolved-path-alias'],
    ['an alias-looking specifier no tsconfig pattern covers', { 'root.ts': "import '@/thing';" }, 'unresolved-path-alias'],
    ['a workspace-scope package that does not exist', { 'root.ts': "import '@miljobeslut/ghost';" }, 'unresolved-workspace-package'],
    ['a workspace package whose exports map has no such subpath', { 'root.ts': "import '@miljobeslut/ws/other';", 'packages/ws/package.json': JSON.stringify({ name: '@miljobeslut/ws', exports: { '.': './i.ts' } }), 'packages/ws/i.ts': '' }, 'unresolved-workspace-package'],
    ['an absolute specifier', { 'root.ts': "import '/etc/x';" }, 'unsupported-specifier'],
    ['a URL specifier', { 'root.ts': "import 'https://example.invalid/x.js';" }, 'unsupported-specifier'],
    ['a root that is not in the tree', { 'other.ts': '' }, 'missing-root'],
    ['a file that does not parse', { 'root.ts': "import './bad';", 'bad.ts': 'export const = ;;; (' }, 'syntax-error'],
    ['a missing tsconfig', { 'root.ts': '' }, 'tsconfig-unreadable', { withConfig: false }],
  ];
  it.each(cases)('%s', (_name, files, kind, extra) => {
    const result = computeClosure(tree(files, extra?.withConfig ?? true), extra?.roots ?? ['root.ts']);
    expect(result.unresolved.map((u) => u.kind)).toContain(kind);
    expect(result.unresolved.length).toBeGreaterThan(0);
  });

  it('a tsconfig that uses extends is a blocker (it is not followed)', () => {
    const r = computeClosure(memoryTreeReader({ 'tsconfig.json': '{"extends":"./base.json"}', 'root.ts': '' }), ['root.ts']);
    expect(r.unresolved.map((u) => u.kind)).toContain('tsconfig-unreadable');
  });

  it('a file the tree lists but cannot read is a blocker (never "not reachable")', () => {
    const base = memoryTreeReader({ 'tsconfig.json': TSCONFIG, 'root.ts': "import './ghost';", 'ghost.ts': 'x' });
    const unreadable: TreeReader = { ...base, read: (p) => (p === 'ghost.ts' ? null : base.read(p)) };
    const r = computeClosure(unreadable, ['root.ts']);
    expect(r.unresolved.map((u) => u.kind)).toEqual(['unreadable-file']);
    expect(r.union_all).toContain('ghost.ts');
  });

  it('a blocker found only through a type-only edge still blocks', () => {
    expect(kinds({ 'root.ts': "import type { T } from './nope';" })).toEqual(['unresolved-relative']);
  });

  it('a clean tree has an empty unresolved list', () => {
    expect(kinds({ 'root.ts': "import './a';", 'a.ts': 'export const a = 1;' })).toEqual([]);
  });
});

describe('classification by reachability only (no allowlist)', () => {
  const dynamicTest = "const IMPL = './impl';\nexport async function load() { return import(IMPL + '.ts'); }\n";
  const base = {
    'tsconfig.json': TSCONFIG,
    'server/index.ts': "import './app';",
    'server/app.ts': 'export const a = 1;',
    'packages/p/tests/frozen.test.ts': dynamicTest,
    'packages/p/src/impl.ts': 'export const i = 1;',
  };

  it('a test file nobody in the production closure imports is outside it, and its non-literal import is outside the production closure', () => {
    const t = memoryTreeReader(base);
    const closure = computeClosure(t, ['server/index.ts']);
    expect(closure.union_all).not.toContain('packages/p/tests/frozen.test.ts');
    expect(closure.unresolved).toEqual([]);
    const census = censusTree(t, closure.union_all);
    expect(census.hits.map((h) => [h.file, h.test, h.classification])).toEqual([['packages/p/tests/frozen.test.ts', true, 'outside-production-closure']]);
    expect(census.nonliteral_in_union_closure).toBe(0);
  });

  it('NEGATIVE CONTROL: a production file that imports that test file puts it in the closure; the hit is blocking and the closure is unresolved', () => {
    const t = memoryTreeReader({ ...base, 'server/app.ts': "import '../packages/p/tests/frozen.test';" });
    const closure = computeClosure(t, ['server/index.ts']);
    expect(closure.union_all).toContain('packages/p/tests/frozen.test.ts');
    expect(closure.unresolved.map((u) => u.kind)).toContain('nonliteral-dynamic-import');
    const census = censusTree(t, closure.union_all);
    expect(census.hits.map((h) => h.classification)).toEqual(['blocking-in-production-closure']);
    expect(census.nonliteral_in_union_closure).toBe(1);
  });

  it('the census counts literal edges and splits test from non-test without any expected total', () => {
    const t = memoryTreeReader({ 'a.ts': "import('./x'); import(y);", 'b.test.ts': 'require(z);', 'c.js': 'const n = require("n");' });
    const c = censusTree(t, ['a.ts']);
    expect([c.code_files_parsed, c.literal_edges, c.nonliteral_total, c.nonliteral_test, c.nonliteral_non_test, c.nonliteral_in_union_closure]).toEqual([3, 2, 2, 1, 1, 1]);
  });
});

describe('parseModule', () => {
  it('classifies each import form and keeps line numbers', () => {
    const m = parseModule('f.ts', "import a from './a';\nexport { b } from './b';\nconst x = import('./c');\nconst y = require('./d');\nimport(z);");
    expect(m.edges.map((e) => [e.specifier, e.form, e.line])).toEqual([['./a', 'static', 1], ['./b', 'export', 2], ['./c', 'dynamic', 3], ['./d', 'require', 4]]);
    expect(m.nonliteral.map((h) => [h.form, h.line])).toEqual([['import', 5]]);
  });
});
