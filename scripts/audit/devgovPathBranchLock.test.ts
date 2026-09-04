import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canonicalPath,
  classifyDiffScope,
  evaluateRepositoryState,
  readRepositoryState,
  RESULT,
} from '../devgov/devgov.mjs';

const baseManifest = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'DEV-GOV-V0-TEST',
  role: 'producer',
  mode: 'writer',
  branch: 'codex/dev-gov-v0-test',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**', 'scripts/audit/devgov*.test.ts'],
  forbidden_paths: ['server/**', '.github/workflows/deploy-*.yml'],
};
const context = { candidateSha: 'b'.repeat(40), worktree: process.cwd() };

function state(overrides = {}) {
  return {
    worktree: process.cwd(),
    branch: 'codex/dev-gov-v0-test',
    head_sha: 'b'.repeat(40),
    parent_sha: 'a'.repeat(40),
    parent_count: 1,
    merge_base_sha: 'a'.repeat(40),
    is_descendant_of_base: true,
    dirty: false,
    changed_paths: ['scripts/devgov/devgov.mjs'],
    ...overrides,
  };
}

describe('DEV-GOV-V0 path/branch lock', () => {
  it('denies wrong worktree after canonical path comparison', () => {
    const result = evaluateRepositoryState(
      baseManifest,
      state({ worktree: join(process.cwd(), '..') }),
      context,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('worktree mismatch');
  });

  it('uses OS path semantics instead of global lowercasing', () => {
    const upperVariant = process.cwd().replaceAll('\\', '/').toUpperCase();
    if (process.platform === 'win32') {
      expect(canonicalPath(upperVariant)).toBe(canonicalPath(process.cwd()));
    } else {
      expect(canonicalPath('/tmp/DevGovCase', process.cwd(), { platform: 'linux' })).not.toBe(
        canonicalPath('/tmp/devgovcase', process.cwd(), { platform: 'linux' }),
      );
    }
    expect(canonicalPath('/tmp/DevGovCase', process.cwd(), { platform: 'linux' })).not.toBe(
      canonicalPath('/tmp/devgovcase', process.cwd(), { platform: 'linux' }),
    );
  });

  it('canonicalizes symlinked paths to the same real path', () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-path-'));
    const link = join(root, 'link');
    try {
      symlinkSync(process.cwd(), link, 'junction');
      expect(canonicalPath(realpathSync.native(link))).toBe(canonicalPath(process.cwd()));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('denies wrong branch and dirty tree', () => {
    const result = evaluateRepositoryState(baseManifest, state({ branch: 'main', dirty: true }), context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('branch mismatch');
    expect(result.errors.join('\n')).toContain('dirty tree rejected');
  });

  it('gives forbidden_paths precedence over broad allowed paths', () => {
    const violations = classifyDiffScope(['server/routes/auth.ts'], ['**/*.ts'], ['server/**']);

    expect(violations).toEqual([{ path: 'server/routes/auth.ts', reason: 'FORBIDDEN_PATH' }]);
  });

  it('matches non-ASCII forbidden paths from raw git path bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-nonascii-'));
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'devgov@example.invalid']);
    git(['config', 'user.name', 'DEV-GOV Test']);
    writeFileSync(join(root, 'README.md'), 'base\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, 'server', 'miljöbeslut-hemlig.ts'), 'export const secret = true;\n');
    git(['add', 'server/miljöbeslut-hemlig.ts']);
    git(['commit', '-m', 'add non-ascii server path']);
    const definition = {
      ...baseManifest,
      branch: 'main',
      base_sha: base,
    };
    const state = readRepositoryState(definition, {
      candidateSha: git(['rev-parse', 'HEAD']),
      worktree: root,
    });

    const violations = classifyDiffScope(state.changed_paths, ['**/*.ts'], ['server/**']);

    expect(violations).toEqual([{ path: 'server/miljöbeslut-hemlig.ts', reason: 'FORBIDDEN_PATH' }]);
  });

  it('denies files outside allowed paths', () => {
    const result = evaluateRepositoryState(
      baseManifest,
      state({ changed_paths: ['docs/random.md'] }),
      context,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('NOT_ALLOWED: docs/random.md');
  });
});
