import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { evaluateInvariantPacks } from '../devgov/invariant-packs.mjs';

const REPO_ROOT = process.cwd();
const RUNNER = resolve(REPO_ROOT, 'scripts/devgov/invariant-packs.mjs');
const tempRoots: string[] = [];
const TARGET_FILES = [
  '.github/workflows/devgov-v0-attest.yml',
  '.github/workflows/devgov-v0-gate.yml',
  '.github/workflows/devgov-v0-orchestrate.yml',
  '.github/workflows/devgov-invariant-packs.yml',
  'scripts/devgov/devgov.mjs',
  'scripts/devgov/invariant-packs.mjs',
  'governance/devgov/invariant-packs/registry-v1.json',
  'governance/devgov/invariant-packs/devgov-controller-core-v1.json',
];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function targetFixture() {
  const root = mkdtempSync(join(tmpdir(), 'devgov-invariant-pack-target-'));
  tempRoots.push(root);
  for (const rel of TARGET_FILES) {
    const dst = join(root, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(REPO_ROOT, rel), dst);
  }
  return root;
}

function mutate(root: string, rel: string, from: string, to: string) {
  const path = join(root, rel);
  const source = readFileSync(path, 'utf8');
  expect(source).toContain(from);
  writeFileSync(path, source.replace(from, to));
}

function evaluate(root: string) {
  return evaluateInvariantPacks({
    controllerRoot: REPO_ROOT,
    targetRoot: root,
    controllerSha: 'd'.repeat(40),
    candidateSha: 'c'.repeat(40),
  });
}

describe('DEV-GOV controller-owned invariant packs', () => {
  it('passes the live controller tree and binds controller/candidate/pack-set identity', () => {
    const report = evaluateInvariantPacks({ controllerRoot: REPO_ROOT, targetRoot: REPO_ROOT });

    expect(report.result).toBe('PASS');
    expect(report.controller_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.candidate_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.registry_version).toBe(1);
    expect(report.pack_set_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.active_packs).toHaveLength(1);
    expect(report.invariants).toHaveLength(8);
    expect(report.failed_invariants).toEqual([]);
  });

  it('uses the controller registry even when the target tries to replace its own active pack set', () => {
    const root = targetFixture();
    const registryPath = join(root, 'governance/devgov/invariant-packs/registry-v1.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.active_packs = ['governance/devgov/invariant-packs/candidate-self-approved-v99.json'];
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const report = evaluate(root);

    expect(report.active_packs.map((pack) => pack.pack_id)).toEqual(['DEVGOV-CONTROLLER-CORE']);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-006-ALL-PACKS-NO-CANDIDATE-SELECTION');
  });

  it('fails if a candidate redirects trusted proof execution from controller code to candidate code', () => {
    const root = targetFixture();
    mutate(
      root,
      '.github/workflows/devgov-v0-attest.yml',
      'node controller/scripts/devgov/devgov.mjs execute-proof',
      'node candidate/scripts/devgov/devgov.mjs execute-proof',
    );

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-001-PROTECTED-CONTROLLER-SEPARATION');
  });

  it('fails if canonical gate stops running the controller-owned pack set', () => {
    const root = targetFixture();
    mutate(
      root,
      '.github/workflows/devgov-v0-gate.yml',
      'node controller/scripts/devgov/invariant-packs.mjs',
      'node controller/scripts/devgov/invariant-packs-disabled.mjs',
    );

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-005-PACKS-LOAD-BEARING');
  });

  it('fails if the all-PR check stops using pull_request_target protected-base semantics', () => {
    const root = targetFixture();
    mutate(root, '.github/workflows/devgov-invariant-packs.yml', 'pull_request_target:', 'pull_request:');

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-007-PR-PROTECTED-BASE');
  });

  it('has no caller-selectable pack switch', () => {
    const result = spawnSync(process.execPath, [RUNNER, '--target', REPO_ROOT, '--pack', 'candidate-v99'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown invariant-pack argument: --pack');
  });
});
