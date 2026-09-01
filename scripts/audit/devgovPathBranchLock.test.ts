import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canonicalPath, classifyDiffScope, evaluateRepositoryState, RESULT } from '../devgov/devgov.mjs';

const baseManifest = {
  schema_version: 'dev-gov-v0',
  unit: 'DEV-GOV-V0-TEST',
  role: 'producer',
  mode: 'writer',
  worktree: process.cwd(),
  branch: 'codex/dev-gov-v0-test',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**', 'scripts/audit/devgov*.test.ts'],
  forbidden_paths: ['server/**', '.github/workflows/deploy-*.yml'],
};

function state(overrides = {}) {
  return {
    worktree: process.cwd(),
    branch: 'codex/dev-gov-v0-test',
    head_sha: 'b'.repeat(40),
    parent_sha: 'a'.repeat(40),
    merge_base_sha: 'a'.repeat(40),
    is_descendant_of_base: true,
    dirty: false,
    changed_paths: ['scripts/devgov/devgov.mjs'],
    ...overrides,
  };
}

describe('DEV-GOV-V0 path/branch lock', () => {
  it('denies wrong worktree after canonical path comparison', () => {
    const result = evaluateRepositoryState(baseManifest, state({ worktree: join(process.cwd(), '..') }));

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('worktree mismatch');
  });

  it('canonicalizes slash and casing variants of the same existing path', () => {
    expect(canonicalPath(process.cwd().replaceAll('\\', '/').toUpperCase())).toBe(
      canonicalPath(process.cwd()),
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
    const result = evaluateRepositoryState(baseManifest, state({ branch: 'main', dirty: true }));

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('branch mismatch');
    expect(result.errors.join('\n')).toContain('dirty tree rejected');
  });

  it('gives forbidden_paths precedence over broad allowed paths', () => {
    const violations = classifyDiffScope(['server/routes/auth.ts'], ['**/*.ts'], ['server/**']);

    expect(violations).toEqual([{ path: 'server/routes/auth.ts', reason: 'FORBIDDEN_PATH' }]);
  });

  it('denies files outside allowed paths', () => {
    const result = evaluateRepositoryState(baseManifest, state({ changed_paths: ['docs/random.md'] }));

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('NOT_ALLOWED: docs/random.md');
  });
});
