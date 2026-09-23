import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const boundary: any = await import('../../scripts/dev-helpers/lib/luApiBoundary.mjs');
const {
  collectProductionDeepImports,
  collectPublicExports,
  diffStringSets,
  evaluateLuApiBoundary,
  loadLuApiBoundarySnapshot,
} = boundary;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'lu-api-boundary-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

describe('LU package API boundary snapshot', () => {
  it('matches the exact public export surface and grandfathered production deep-import baseline', () => {
    const snapshot = loadLuApiBoundarySnapshot(process.cwd());
    const report = evaluateLuApiBoundary(process.cwd());

    expect(snapshot.public_exports.length).toBeGreaterThan(200);
    expect(snapshot.grandfathered_deep_imports.length).toBeGreaterThan(0);
    expect(report.result).toBe('PASS');
    expect(report.authoritative).toBe(false);
    expect(report.public_export_count).toBe(snapshot.public_exports.length);
    expect(report.grandfathered_deep_import_count).toBe(snapshot.grandfathered_deep_imports.length);
    expect(report.forbidden_exports_present).toEqual([]);
    expect(report.export_diff).toEqual({ added: [], removed: [] });
    expect(report.deep_import_diff).toEqual({ added: [], removed: [] });
  });

  it('resolves transitive export-star symbols rather than snapshotting index text', () => {
    const root = fixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', target: 'es2022' } }),
      'packages/mps-lu/src/index.ts': "export * from './domain/Public';\n",
      'packages/mps-lu/src/domain/Public.ts':
        'export const alpha = 1;\nexport type Beta = { readonly value: string };\n',
    });

    expect(collectPublicExports(root)).toEqual(['Beta', 'alpha']);
    writeFileSync(
      join(root, 'packages/mps-lu/src/domain/Public.ts'),
      'export const alpha = 1;\nexport const gamma = 2;\nexport type Beta = { readonly value: string };\n',
    );
    expect(collectPublicExports(root)).toEqual(['Beta', 'alpha', 'gamma']);
  });

  it('detects a newly introduced production deep import by AST, not by comment text', () => {
    const root = fixture({
      'src/violating.ts':
        "import { LURuleEngine } from '../packages/mps-lu/src/rules/LURuleEngine';\nvoid LURuleEngine;\n",
      'packages/mps-lu/src/index.ts': 'export const publicApi = 1;\n',
    });

    expect(collectProductionDeepImports(root)).toEqual([
      {
        file: 'src/violating.ts',
        specifier: '../packages/mps-lu/src/rules/LURuleEngine',
      },
    ]);
  });

  it('ignores comments, string fixtures and the supported package-root import', () => {
    const root = fixture({
      'src/clean.ts': [
        "import { publicApi } from '@miljobeslut/mps-lu';",
        'const fixtureText = "import { x } from \'@miljobeslut/mps-lu/src/internal\';";',
        "// import { x } from '@miljobeslut/mps-lu/src/internal';",
        'void publicApi;',
        'void fixtureText;',
        '',
      ].join('\n'),
      'packages/mps-lu/src/index.ts': 'export const publicApi = 1;\n',
    });

    expect(collectProductionDeepImports(root)).toEqual([]);
  });

  it('treats additions and removals as explicit snapshot drift', () => {
    expect(diffStringSets(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      added: ['c'],
      removed: [],
    });
    expect(diffStringSets(['a', 'b'], ['b'])).toEqual({
      added: [],
      removed: ['a'],
    });
  });

  it('keeps the known forbidden execution internals outside the package root', () => {
    const snapshot = loadLuApiBoundarySnapshot(resolve(process.cwd()));
    expect(snapshot.forbidden_root_exports).toEqual([
      'LURuleEngine',
      'createLuRuleEngineInvokeHandler',
      'runLuAssessmentViaKernel',
    ]);
    expect(snapshot.public_exports).not.toContain('LURuleEngine');
    expect(snapshot.public_exports).not.toContain('createLuRuleEngineInvokeHandler');
    expect(snapshot.public_exports).not.toContain('runLuAssessmentViaKernel');
  });
});
