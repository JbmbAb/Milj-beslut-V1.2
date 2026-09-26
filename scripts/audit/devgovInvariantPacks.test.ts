import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    chmodSync(dst, 0o600);
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
    const report = evaluateInvariantPacks({
      controllerRoot: REPO_ROOT,
      targetRoot: REPO_ROOT,
      controllerSha: 'd'.repeat(40),
      candidateSha: 'c'.repeat(40),
    });

    expect(report.result).toBe('PASS');
    expect(report.controller_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.candidate_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.registry_version).toBe(1);
    expect(report.pack_set_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.active_packs).toHaveLength(1);
    expect(report.invariants).toHaveLength(9);
    expect(report.failed_invariants).toEqual([]);
  });

  // Anti-self-bootstrap rule (docs/architecture/audits/DEVGOV-INVARIANT-PACKS-V1.md "Bootstrap
  // rule"): a candidate's proposed registry or pack version is target data only and becomes
  // normative only after merge to the protected controller. Actual pack execution always resolves
  // active_packs from controllerRoot (proven by the assertion immediately below), never from the
  // target's own copy, so a target rewriting its own inert registry copy is a no-op, not a
  // violation. Do NOT reintroduce an expectation that this scenario FAILs DG-IP-006.
  it('uses the controller registry even when the target tries to replace its own active pack set', () => {
    const root = targetFixture();
    const registryPath = join(root, 'governance/devgov/invariant-packs/registry-v1.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.active_packs = ['governance/devgov/invariant-packs/candidate-self-approved-v99.json'];
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const report = evaluate(root);

    expect(report.active_packs.map((pack) => pack.pack_id)).toEqual(['DEVGOV-CONTROLLER-CORE']);
    expect(report.result).toBe('PASS');
    expect(report.failed_invariants).toEqual([]);
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

  // Regression coverage for F-10: a candidate can obfuscate a redirected attest-execution
  // invocation behind a decoy comment (satisfying the old bare hasAll() text check) plus a
  // dynamically-assembled `node "$SIGNER_SCRIPT" attest-execution` that is what actually executes.
  it('fails DG-IP-001 if a candidate redirects attest-execution via a decoy comment and a dynamically-assembled node target', () => {
    const root = targetFixture();
    mutate(
      root,
      '.github/workflows/devgov-v0-attest.yml',
      '          node controller/scripts/devgov/devgov.mjs attest-execution \\',
      '          # decoy (never executed, satisfies textual audit): node controller/scripts/devgov/devgov.mjs attest-execution\n          P1="cand"; P2="idate"; SIGNER_SCRIPT="${P1}${P2}/scripts/devgov/devgov.mjs"\n          node "$SIGNER_SCRIPT" attest-execution \\',
    );

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-001-PROTECTED-CONTROLLER-SEPARATION');
  });

  // Regression coverage for F-10, defense-in-depth layer: the dynamic-target class must be caught
  // even with no decoy comment at all, proving noDynamicNodeInvocation alone closes the gap
  // independent of comment-stripping.
  it('fails DG-IP-001 if a candidate redirects attest-execution via a dynamically-assembled node target with no decoy comment', () => {
    const root = targetFixture();
    mutate(
      root,
      '.github/workflows/devgov-v0-attest.yml',
      '          node controller/scripts/devgov/devgov.mjs attest-execution \\',
      '          SIGNER_SCRIPT="controller/scripts/devgov/devgov.mjs"\n          node "$SIGNER_SCRIPT" attest-execution \\',
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

  // Regression coverage for the DG-IP-006 self-check tautology (ROOT_CAUSE_4): the check must
  // actually inspect the target's real controllerRoot line, not a needle that only ever matches
  // its own quoted copy inside the checker's source.
  it('fails DG-IP-006 if a candidate weakens the real controllerRoot override resolution', () => {
    const root = targetFixture();
    // Targets the REAL multi-line functional statement inside evaluateInvariantPacks, not the
    // DG-IP-006 checker's own quoted needle strings (single-line, inside the switch-case that
    // stripInvariantEvaluatorBody excises before this invariant's checks run), so this regression
    // test must mutate the real code, never the checker's copy of what it searches for.
    mutate(
      root,
      'scripts/devgov/invariant-packs.mjs',
      "  const controllerRoot = realpathSync(\n    options.controllerRoot || resolve(dirname(fileURLToPath(import.meta.url)), '../..'),\n  );",
      "  const controllerRoot = realpathSync(\n    resolve(dirname(fileURLToPath(import.meta.url)), '../..'),\n  );",
    );

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-006-ALL-PACKS-NO-CANDIDATE-SELECTION');
  });

  // Regression coverage for the DG-IP-006 idiom-specific CLI self-check (ROOT_CAUSE_3): a
  // caller-usable authority-override flag added via a non-`===` idiom must still be caught by the
  // idiom-agnostic denylist, not only by the exact-three-flags regex match.
  it('fails DG-IP-006 if a candidate adds a caller-usable --pack flag via a non-strict-equality idiom', () => {
    const root = targetFixture();
    mutate(
      root,
      'scripts/devgov/invariant-packs.mjs',
      "    if (arg === '--target') options.target = argv[++i];",
      "    switch (arg) {\n      case '--pack':\n        options.pack = argv[++i];\n        break;\n      default:\n        break;\n    }\n    if (arg === '--target') options.target = argv[++i];",
    );

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-006-ALL-PACKS-NO-CANDIDATE-SELECTION');
  });

  // Regression coverage for the DG-IP-002 loose bare-substring check (ROOT_CAUSE_5): removing the
  // real job-level `environment: devgov-attestation` key while leaving a decoy bare-literal
  // occurrence elsewhere in the signing job must still fail signer isolation.
  it('fails DG-IP-002 if a candidate removes the real signer environment binding but leaves a decoy literal', () => {
    const root = targetFixture();
    mutate(
      root,
      '.github/workflows/devgov-v0-attest.yml',
      '    environment: devgov-attestation\n    steps:',
      '    # environment: devgov-attestation (decoy comment, not a real binding)\n    steps:',
    );

    const report = evaluate(root);
    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-002-SIGNER-ISOLATION');
  });

  // Regression coverage for F-12 (DG-IP-000-CANONICAL-SET-COMPLETE): active_packs is always
  // resolved from controllerRoot, never targetRoot (see the anti-self-bootstrap test above), so
  // this must supply the fixture as BOTH controllerRoot and targetRoot to actually exercise a
  // controller-owned pack that silently drops a canonical V1 invariant id.
  it('fails DG-IP-000 if the controller-owned pack set drops one of the canonical V1 invariant ids', () => {
    const root = targetFixture();
    const packPath = join(root, 'governance/devgov/invariant-packs/devgov-controller-core-v1.json');
    const pack = JSON.parse(readFileSync(packPath, 'utf8'));
    pack.invariants = pack.invariants.filter((id: string) => id !== 'DG-IP-008-POST-MERGE-ACTIVATION');
    writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);

    const report = evaluateInvariantPacks({
      controllerRoot: root,
      targetRoot: root,
      controllerSha: 'd'.repeat(40),
      candidateSha: 'c'.repeat(40),
    });

    expect(report.result).toBe('FAIL');
    expect(report.failed_invariants).toContain('DG-IP-000-CANONICAL-SET-COMPLETE');
  });
});
