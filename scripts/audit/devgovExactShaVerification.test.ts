import { describe, expect, it } from 'vitest';

import { evaluateRepositoryState, evaluateShaVerification, RESULT } from '../devgov/devgov.mjs';

const manifest = {
  schema_version: 'dev-gov-v0',
  unit: 'DEV-GOV-V0-SHA',
  role: 'verifier',
  mode: 'read_only',
  worktree: process.cwd(),
  branch: 'codex/dev-gov-v0-test',
  base_sha: 'a'.repeat(40),
  target_sha: 'b'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['.github/workflows/deploy-*.yml'],
  remote: { name: 'origin', branch: 'codex/dev-gov-v0-test', push_policy: 'no_force' },
};

function repoState(overrides = {}) {
  return {
    worktree: process.cwd(),
    branch: manifest.branch,
    head_sha: manifest.target_sha,
    parent_sha: manifest.base_sha,
    merge_base_sha: manifest.base_sha,
    is_descendant_of_base: true,
    remote_sha: manifest.target_sha,
    dirty: false,
    changed_paths: ['scripts/devgov/devgov.mjs'],
    ...overrides,
  };
}

describe('DEV-GOV-V0 exact SHA and ancestry verification', () => {
  it('supports explicit exact_parent ancestry and denies wrong parent', () => {
    const result = evaluateRepositoryState(manifest, repoState({ parent_sha: 'c'.repeat(40) }));

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('parent mismatch');
  });

  it('supports descendant_of_base without requiring direct parent', () => {
    const descendantManifest = { ...manifest, ancestry_policy: 'descendant_of_base' };

    expect(
      evaluateRepositoryState(descendantManifest, repoState({ parent_sha: 'c'.repeat(40) })).result,
    ).toBe(RESULT.PASS);
    expect(
      evaluateRepositoryState(descendantManifest, repoState({ is_descendant_of_base: false })).result,
    ).toBe(RESULT.DENIED_GOVERNANCE);
  });

  it('supports merge_base_equals_base policy', () => {
    const mergeBaseManifest = { ...manifest, ancestry_policy: 'merge_base_equals_base' };

    expect(evaluateRepositoryState(mergeBaseManifest, repoState()).result).toBe(RESULT.PASS);
    expect(
      evaluateRepositoryState(mergeBaseManifest, repoState({ merge_base_sha: 'd'.repeat(40) })).result,
    ).toBe(RESULT.DENIED_GOVERNANCE);
  });

  it('denies local target SHA mismatch', () => {
    const result = evaluateShaVerification(manifest, repoState({ head_sha: 'c'.repeat(40) }));

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('local HEAD mismatch');
  });

  it('denies remote SHA divergence', () => {
    const result = evaluateShaVerification(manifest, repoState({ remote_sha: 'c'.repeat(40) }));

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('remote SHA mismatch');
  });

  it('denies dirty trees during exact SHA verification', () => {
    expect(evaluateShaVerification(manifest, repoState({ dirty: true })).result).toBe(
      RESULT.DENIED_GOVERNANCE,
    );
  });

  it('keeps BLOCKED_ENVIRONMENT distinct from governance denial and command failure', () => {
    expect(Object.values(RESULT)).toEqual(['PASS', 'FAIL', 'BLOCKED_ENVIRONMENT', 'DENIED_GOVERNANCE']);
  });
});
