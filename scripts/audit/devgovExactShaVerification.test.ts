import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateRepositoryState,
  evaluateShaVerification,
  readRepositoryState,
  resolveRemoteVerification,
  RESULT,
} from '../devgov/devgov.mjs';

const manifest = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'DEV-GOV-V0-SHA',
  role: 'verifier',
  mode: 'read_only',
  branch: 'codex/dev-gov-v0-test',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['.github/workflows/deploy-*.yml'],
  remote: { name: 'origin', branch: 'codex/dev-gov-v0-test', push_policy: 'no_force' },
};
const candidateSha = 'b'.repeat(40);
const context = { candidateSha, worktree: process.cwd() };

function repoState(overrides = {}) {
  return {
    worktree: process.cwd(),
    branch: manifest.branch,
    head_sha: candidateSha,
    parent_sha: manifest.base_sha,
    parent_count: 1,
    merge_base_sha: manifest.base_sha,
    is_descendant_of_base: true,
    remote_sha: candidateSha,
    dirty: false,
    changed_paths: ['scripts/devgov/devgov.mjs'],
    ...overrides,
  };
}

describe('DEV-GOV-V0 exact SHA and ancestry verification', () => {
  it('supports explicit exact_parent ancestry and denies wrong parent', () => {
    const result = evaluateRepositoryState(manifest, repoState({ parent_sha: 'c'.repeat(40) }), context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('parent mismatch');
  });

  it('denies merge commits under exact_parent even when first parent is the base', () => {
    const result = evaluateRepositoryState(manifest, repoState({ parent_count: 2 }), context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('exact_parent requires one parent');
  });

  it('supports descendant_of_base without requiring direct parent', () => {
    const descendantManifest = { ...manifest, ancestry_policy: 'descendant_of_base' };

    expect(
      evaluateRepositoryState(descendantManifest, repoState({ parent_sha: 'c'.repeat(40) }), context).result,
    ).toBe(RESULT.PASS);
    expect(
      evaluateRepositoryState(descendantManifest, repoState({ is_descendant_of_base: false }), context)
        .result,
    ).toBe(RESULT.DENIED_GOVERNANCE);
  });

  it('supports merge_base_equals_base policy', () => {
    const mergeBaseManifest = { ...manifest, ancestry_policy: 'merge_base_equals_base' };

    expect(evaluateRepositoryState(mergeBaseManifest, repoState(), context).result).toBe(RESULT.PASS);
    expect(
      evaluateRepositoryState(mergeBaseManifest, repoState({ merge_base_sha: 'd'.repeat(40) }), context)
        .result,
    ).toBe(RESULT.DENIED_GOVERNANCE);
  });

  it('reads real merge commit parent count for exact_parent enforcement', () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-merge-parent-'));
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'devgov@example.invalid']);
    git(['config', 'user.name', 'DEV-GOV Test']);
    writeFileSync(join(root, 'file.txt'), 'base\n');
    git(['add', 'file.txt']);
    git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    git(['checkout', '-b', 'side']);
    writeFileSync(join(root, 'side.txt'), 'side\n');
    git(['add', 'side.txt']);
    git(['commit', '-m', 'side']);
    git(['checkout', 'main']);
    writeFileSync(join(root, 'main.txt'), 'main\n');
    git(['add', 'main.txt']);
    git(['commit', '-m', 'main']);
    git(['merge', '--no-ff', 'side', '-m', 'merge side']);

    const realManifest = {
      ...manifest,
      branch: 'main',
      base_sha: base,
      allowed_paths: ['**/*'],
      forbidden_paths: [],
    };
    const realCandidateSha = git(['rev-parse', 'HEAD']);
    const realContext = { candidateSha: realCandidateSha, worktree: root };
    const result = evaluateRepositoryState(
      realManifest,
      readRepositoryState(realManifest, realContext),
      realContext,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('exact_parent requires one parent');
  });

  it('denies local target SHA mismatch', () => {
    const result = evaluateShaVerification(manifest, repoState({ head_sha: 'c'.repeat(40) }), context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('local HEAD mismatch');
  });

  it('denies candidate identity authored inside the unit definition', () => {
    const selfReferential = { ...manifest, target_sha: candidateSha };

    const result = evaluateShaVerification(selfReferential, repoState(), context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('target_sha is forbidden in a unit definition');
  });

  it('denies remote SHA divergence', () => {
    const result = evaluateShaVerification(manifest, repoState({ remote_sha: 'c'.repeat(40) }), context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('remote SHA mismatch');
  });

  it('fails closed on remote lookup failure instead of treating it as absent success', () => {
    const missingRemoteManifest = {
      ...manifest,
      remote: { name: 'definitely-missing-devgov-remote', branch: 'main' },
    };
    const state = resolveRemoteVerification(missingRemoteManifest, repoState(), context);
    const result = evaluateShaVerification(missingRemoteManifest, state, context);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('remote lookup failed');
  });

  it('denies dirty trees during exact SHA verification', () => {
    expect(evaluateShaVerification(manifest, repoState({ dirty: true }), context).result).toBe(
      RESULT.DENIED_GOVERNANCE,
    );
  });

  it('keeps BLOCKED_ENVIRONMENT distinct from governance denial and command failure', () => {
    expect(Object.values(RESULT)).toEqual(['PASS', 'FAIL', 'BLOCKED_ENVIRONMENT', 'DENIED_GOVERNANCE']);
  });
});
