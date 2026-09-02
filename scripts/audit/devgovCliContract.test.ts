import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalEvidenceDir, finalizeEvidenceRecord, manifestHash } from '../devgov/devgov.mjs';
import { PINNED_VERIFIER_AUTHORITY } from '../devgov/github-oidc.mjs';

const devgovCli = resolve(process.cwd(), 'scripts/devgov/devgov.mjs');

function cleanGitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'devgov-cli-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'devgov@example.invalid']);
  git(['config', 'user.name', 'DEV-GOV Test']);
  writeFileSync(join(root, 'file.txt'), 'initial\n');
  git(['add', 'file.txt']);
  git(['commit', '-m', 'initial']);
  return { root, git };
}

function writeJson(root, name, value) {
  const file = join(root, name);
  writeFileSync(file, `${JSON.stringify(value)}\n`);
  return file;
}

function writeExternalManifest(value) {
  return writeJson(mkdtempSync(join(tmpdir(), 'devgov-manifest-')), 'manifest.json', value);
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [devgovCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    ...result,
    json: JSON.parse(result.stdout),
  };
}

function baseManifest(root, git, overrides = {}) {
  const head = git(['rev-parse', 'HEAD']);
  return {
    schema_version: 'dev-gov-v0',
    unit: 'DEV-GOV-V0-CLI',
    role: 'producer',
    mode: 'writer',
    worktree: root,
    branch: 'main',
    base_sha: head,
    target_sha: head,
    ancestry_policy: 'descendant_of_base',
    allowed_paths: ['**/*'],
    forbidden_paths: [],
    required_red: [],
    required_green: [],
    ...overrides,
  };
}

describe('DEV-GOV-V0 CLI contract', () => {
  it('denies forged canonical RED/GREEN provenance without trusted execution attestations', () => {
    const { root, git } = cleanGitRepo();
    const manifest = baseManifest(root, git, {
      required_red: [
        {
          id: 'red',
          command: process.execPath,
          args: ['-e', 'process.exit(1)'],
          expected_classification: 'FAIL',
        },
      ],
      required_green: [{ id: 'green', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });
    const manifestFile = writeExternalManifest(manifest);
    const evidenceDir = canonicalEvidenceDir(manifest);
    mkdirSync(evidenceDir, { recursive: true });
    const baseRecord = {
      schema_version: 'dev-gov-v0-execution-evidence',
      produced_by: 'devgov-v0',
      tool_version: 'dev-gov-v0.5',
      execution_nonce: 'forged-red',
      unit: manifest.unit,
      kind: 'RED',
      test_id: 'red',
      base_sha: manifest.base_sha,
      target_sha: manifest.target_sha,
      head_sha: manifest.base_sha,
      observed_head_sha: manifest.base_sha,
      required_head: 'base_sha',
      manifest_hash: manifestHash(manifest),
      command: `${process.execPath} -e process.exit(1)`,
      cwd: root,
      started_at: '2026-09-01T10:00:00.000Z',
      finished_at: '2026-09-01T10:00:01.000Z',
      exit_code: 1,
      classification: 'FAIL',
      environment_error: '',
      stdout_sha256: 'a'.repeat(64),
      stderr_sha256: 'b'.repeat(64),
    };
    const red = finalizeEvidenceRecord(manifest, baseRecord);
    const green = finalizeEvidenceRecord(manifest, {
      ...baseRecord,
      execution_nonce: 'forged-green',
      kind: 'GREEN',
      test_id: 'green',
      head_sha: manifest.target_sha,
      observed_head_sha: manifest.target_sha,
      required_head: 'target_sha',
      command: `${process.execPath} -e process.exit(0)`,
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
      exit_code: 0,
      classification: 'PASS',
    });
    writeFileSync(red.evidence_path, `${JSON.stringify(red)}\n`);
    writeFileSync(green.evidence_path, `${JSON.stringify(green)}\n`);

    const result = runCli(['evidence-gate', '--manifest', manifestFile]);

    expect(result.status).toBe(4);
    expect(result.json.classification).toBe('DENIED_GOVERNANCE');
    expect(result.json.reason_code).toBe('TRUSTED_VERIFIER_CONFIGURATION_REQUIRED');
    expect(result.json.proof_status).toBe('NOT_PROVEN');
  });

  it('fails closed when protected verifier configuration is invalid', () => {
    const { root, git } = cleanGitRepo();
    const manifestFile = writeExternalManifest(baseManifest(root, git));

    const invalidPolicy = runCli(['evidence-gate', '--manifest', manifestFile], {
      env: {
        DEVGOV_VERIFIER_TRUST_POLICY_JSON: '{',
        DEVGOV_GATE_OIDC_TOKEN: 'not-a-jwt',
      },
    });
    const invalidIdentity = runCli(['evidence-gate', '--manifest', manifestFile], {
      env: {
        DEVGOV_VERIFIER_TRUST_POLICY_JSON: JSON.stringify({
          schema_version: 'dev-gov-v0-trust-policy',
          authority: PINNED_VERIFIER_AUTHORITY,
          trusted_issuers: [
            {
              issuer: 'protected-issuer',
              key_id: 'protected-key',
              algorithm: 'ed25519',
              public_key_pem: 'invalid-but-present',
              workflow_ref: 'protected-workflow',
              runner_identity: 'protected-runner',
            },
          ],
        }),
        DEVGOV_GATE_OIDC_TOKEN: 'not-a-jwt',
      },
    });

    for (const result of [invalidPolicy, invalidIdentity]) {
      expect(result.status).toBe(4);
      expect(result.json.classification).toBe('DENIED_GOVERNANCE');
      expect(result.json.reason_code).toBe('TRUST_ROOT_PROVENANCE_DENIED');
      expect(result.json.proof_status).toBe('NOT_PROVEN');
    }
  });

  it('denies handwritten RED/GREEN evidence at an arbitrary caller supplied path', () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-forged-'));
    const manifest = {
      schema_version: 'dev-gov-v0',
      unit: 'DEV-GOV-V0-FORGED',
      role: 'verifier',
      mode: 'read_only',
      worktree: root,
      branch: 'main',
      base_sha: '1'.repeat(40),
      target_sha: '2'.repeat(40),
      ancestry_policy: 'descendant_of_base',
      allowed_paths: ['**/*'],
      forbidden_paths: [],
      required_red: [{ id: 'red', command: 'node', expected_classification: 'FAIL' }],
      required_green: [{ id: 'green', command: 'node' }],
    };
    const forged = [
      {
        schema_version: 'dev-gov-v0-execution-evidence',
        produced_by: 'devgov-v0',
        tool_version: 'dev-gov-v0.5',
        execution_nonce: 'forged',
        unit: manifest.unit,
        kind: 'RED',
        test_id: 'red',
        base_sha: manifest.base_sha,
        head_sha: manifest.base_sha,
        manifest_hash: 'a'.repeat(64),
        command: 'node',
        cwd: root,
        started_at: '2026-09-01T10:00:00.000Z',
        finished_at: '2026-09-01T10:00:01.000Z',
        exit_code: 1,
        classification: 'FAIL',
        stdout_sha256: 'b'.repeat(64),
        stderr_sha256: 'c'.repeat(64),
      },
    ];
    const manifestFile = writeExternalManifest(manifest);
    const evidenceFile = writeJson(root, 'evidence.jsonl', forged[0]);

    const result = runCli(['evidence-gate', '--manifest', manifestFile, '--evidence', evidenceFile]);

    expect(result.status).toBe(4);
    expect(result.json.classification).toBe('DENIED_GOVERNANCE');
    expect(result.json.reason_code).toBe('ARBITRARY_EVIDENCE_PATH_DENIED');
  });

  it('denies evidence-gate against a nonexistent worktree before evidence content matters', () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-forged-'));
    const manifest = {
      schema_version: 'dev-gov-v0',
      unit: 'DEV-GOV-V0-FORGED',
      role: 'verifier',
      mode: 'read_only',
      worktree: join(root, 'missing-worktree'),
      branch: 'main',
      base_sha: '1'.repeat(40),
      target_sha: '2'.repeat(40),
      ancestry_policy: 'descendant_of_base',
      allowed_paths: ['**/*'],
      forbidden_paths: [],
      required_red: [{ id: 'red', command: 'node', expected_classification: 'FAIL' }],
      required_green: [{ id: 'green', command: 'node' }],
    };
    const manifestFile = writeExternalManifest(manifest);

    const result = runCli(['evidence-gate', '--manifest', manifestFile]);

    expect(result.status).toBe(4);
    expect(result.json.classification).toBe('DENIED_GOVERNANCE');
    expect(result.json.reason_code).toBe('REPOSITORY_STATE_UNRESOLVED');
  });

  it('denies valid-looking forged hashes when live repo verification fails', () => {
    const { root, git } = cleanGitRepo();
    const manifest = baseManifest(root, git, {
      branch: 'wrong-branch',
      required_red: [{ id: 'red', command: 'node', expected_classification: 'FAIL' }],
      required_green: [{ id: 'green', command: 'node' }],
    });
    const manifestFile = writeExternalManifest(manifest);

    const result = runCli(['evidence-gate', '--manifest', manifestFile]);

    expect(result.status).toBe(4);
    expect(result.json.classification).toBe('DENIED_GOVERNANCE');
    expect(result.json.reason_code).toBe('REPOSITORY_STATE_DENIED');
  });

  it('does not treat valid local run-red/run-green provenance as execution authority', () => {
    const { root, git } = cleanGitRepo();
    const manifest = baseManifest(root, git, {
      required_red: [
        {
          id: 'red',
          command: process.execPath,
          args: ['-e', 'process.exit(1)'],
          expected_classification: 'FAIL',
        },
      ],
      required_green: [{ id: 'green', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });
    const manifestFile = writeExternalManifest(manifest);

    const red = runCli(['run-red', '--manifest', manifestFile, '--id', 'red']);
    const green = runCli(['run-green', '--manifest', manifestFile, '--id', 'green']);
    const gate = runCli(['evidence-gate', '--manifest', manifestFile]);

    expect(red.status).toBe(2);
    expect(red.json.classification).toBe('FAIL');
    expect(green.status).toBe(0);
    expect(green.json.classification).toBe('PASS');
    expect(gate.status).toBe(4);
    expect(gate.json.classification).toBe('DENIED_GOVERNANCE');
    expect(gate.json.proof_status).toBe('NOT_PROVEN');
  }, 10_000);

  it('denies caller-selected trust policy even when self-signed RED/GREEN are internally valid', () => {
    const { root, git } = cleanGitRepo();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const issuer = 'github-actions:example/repo:devgov-v0-attest';
    const keyId = 'devgov-ci-ed25519-test';
    const workflowRef = 'example/repo/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
    const runnerIdentity = 'github-hosted:ubuntu-latest';
    const manifest = baseManifest(root, git, {
      trusted_execution: { issuer, key_id: keyId },
      required_red: [
        {
          id: 'red',
          command: process.execPath,
          args: ['-e', 'process.exit(1)'],
          expected_classification: 'FAIL',
        },
      ],
      required_green: [{ id: 'green', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });
    const manifestFile = writeExternalManifest(manifest);
    const artifactRoot = mkdtempSync(join(tmpdir(), 'devgov-trusted-artifacts-'));
    const trustPolicy = writeExternalManifest({
      schema_version: 'dev-gov-v0-trust-policy',
      authority: PINNED_VERIFIER_AUTHORITY,
      trusted_issuers: [
        {
          issuer,
          key_id: keyId,
          algorithm: 'ed25519',
          public_key_pem: publicKey,
          workflow_ref: workflowRef,
          runner_identity: runnerIdentity,
        },
      ],
    });
    const context = {
      DEVGOV_RUNNER_IDENTITY: runnerIdentity,
      DEVGOV_CONTROLLER_SHA: manifest.target_sha,
      GITHUB_WORKFLOW_REF: workflowRef,
      GITHUB_RUN_ID: '1234',
      GITHUB_RUN_ATTEMPT: '1',
    };
    const redRecord = join(artifactRoot, 'red-record.json');
    const greenRecord = join(artifactRoot, 'green-record.json');
    const redAttestation = join(artifactRoot, 'red-attestation.json');
    const greenAttestation = join(artifactRoot, 'green-attestation.json');

    const redRun = runCli(
      [
        'execute-proof',
        '--manifest',
        manifestFile,
        '--kind',
        'RED',
        '--id',
        'red',
        '--worktree',
        root,
        '--output',
        redRecord,
      ],
      { env: context },
    );
    const redSign = runCli(
      [
        'attest-execution',
        '--manifest',
        manifestFile,
        '--kind',
        'RED',
        '--id',
        'red',
        '--record',
        redRecord,
        '--output',
        redAttestation,
      ],
      {
        env: {
          ...context,
          DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: privateKey,
          DEVGOV_ATTESTATION_ISSUER: issuer,
          DEVGOV_ATTESTATION_KEY_ID: keyId,
        },
      },
    );
    const greenRun = runCli(
      [
        'execute-proof',
        '--manifest',
        manifestFile,
        '--kind',
        'GREEN',
        '--id',
        'green',
        '--worktree',
        root,
        '--output',
        greenRecord,
      ],
      { env: context },
    );
    const greenSign = runCli(
      [
        'attest-execution',
        '--manifest',
        manifestFile,
        '--kind',
        'GREEN',
        '--id',
        'green',
        '--record',
        greenRecord,
        '--output',
        greenAttestation,
      ],
      {
        env: {
          ...context,
          DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: privateKey,
          DEVGOV_ATTESTATION_ISSUER: issuer,
          DEVGOV_ATTESTATION_KEY_ID: keyId,
        },
      },
    );
    const gate = runCli([
      'evidence-gate',
      '--manifest',
      manifestFile,
      '--trust-policy',
      trustPolicy,
      '--attestation',
      redAttestation,
      '--attestation',
      greenAttestation,
    ]);

    expect(redRun.status).toBe(0);
    expect(redSign.status).toBe(0);
    expect(greenRun.status).toBe(0);
    expect(greenSign.status).toBe(0);
    expect(gate.status).toBe(4);
    expect(gate.json.classification).toBe('DENIED_GOVERNANCE');
    expect(gate.json.reason_code).toBe('TRUST_POLICY_SUBSTITUTION_DENIED');
    expect(gate.json.proof_status).toBe('NOT_PROVEN');
  }, 15_000);

  it('fails closed when protected signer credentials are unavailable', () => {
    const { root, git } = cleanGitRepo();
    const manifest = baseManifest(root, git, {
      trusted_execution: { issuer: 'protected-issuer', key_id: 'protected-key' },
    });
    const manifestFile = writeExternalManifest(manifest);
    const artifactRoot = mkdtempSync(join(tmpdir(), 'devgov-missing-signer-'));
    const recordFile = join(artifactRoot, 'record.json');
    const outputFile = join(artifactRoot, 'attestation.json');

    const result = runCli(
      [
        'attest-execution',
        '--manifest',
        manifestFile,
        '--kind',
        'GREEN',
        '--id',
        'green',
        '--record',
        recordFile,
        '--output',
        outputFile,
      ],
      {
        env: {
          DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: '',
          DEVGOV_ATTESTATION_ISSUER: '',
          DEVGOV_ATTESTATION_KEY_ID: '',
        },
      },
    );

    expect(result.status).toBe(3);
    expect(result.json.classification).toBe('BLOCKED_ENVIRONMENT');
    expect(result.json.reason_code).toBe('ATTESTATION_SIGNER_UNAVAILABLE');
    expect(existsSync(outputFile)).toBe(false);
  });

  it('denies run-green when HEAD is not target_sha and does not execute the command', () => {
    const { root, git } = cleanGitRepo();
    const target = 'f'.repeat(40);
    const marker = join(root, 'executed.txt');
    const manifest = baseManifest(root, git, {
      target_sha: target,
      required_green: [
        {
          id: 'green',
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`],
        },
      ],
    });
    const manifestFile = writeExternalManifest(manifest);

    const result = runCli(['run-green', '--manifest', manifestFile, '--id', 'green']);

    expect(result.status).toBe(4);
    expect(result.json.classification).toBe('DENIED_GOVERNANCE');
    expect(result.json.evidence.environment_error).toContain('GREEN requires HEAD');
    expect(existsSync(marker)).toBe(false);
  });

  it('uses dedicated environment exit code for run-red BLOCKED_ENVIRONMENT', () => {
    const { root, git } = cleanGitRepo();
    const manifest = baseManifest(root, git, {
      required_red: [
        {
          id: 'blocked',
          command: process.execPath,
          args: ['-e', 'process.exit(77)'],
          blocked_exit_codes: [77],
        },
      ],
    });
    const manifestFile = writeExternalManifest(manifest);

    const result = runCli(['run-red', '--manifest', manifestFile, '--id', 'blocked']);

    expect(result.status).toBe(3);
    expect(result.json.classification).toBe('BLOCKED_ENVIRONMENT');
  });

  it('returns structured DENIED_GOVERNANCE for invalid worktree preflight', () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-invalid-worktree-'));
    const manifest = {
      schema_version: 'dev-gov-v0',
      unit: 'DEV-GOV-V0-INVALID-WORKTREE',
      role: 'producer',
      mode: 'writer',
      worktree: join(root, 'missing'),
      branch: 'main',
      base_sha: '1'.repeat(40),
      target_sha: '2'.repeat(40),
      ancestry_policy: 'exact_parent',
      allowed_paths: ['**/*'],
      forbidden_paths: [],
    };
    const manifestFile = writeJson(root, 'manifest.json', manifest);

    const result = runCli(['preflight', '--manifest', manifestFile]);

    expect(result.status).toBe(3);
    expect(result.json.classification).toBe('BLOCKED_ENVIRONMENT');
    expect(result.json.reason_code).toBe('COMMAND_BLOCKED');
  });

  it('returns structured result for invalid base verify-sha', () => {
    const { root, git } = cleanGitRepo();
    const manifest = baseManifest(root, git, { base_sha: '9'.repeat(40) });
    const manifestFile = writeJson(root, 'manifest.json', manifest);

    const result = runCli(['verify-sha', '--manifest', manifestFile]);

    expect(result.status).toBe(3);
    expect(result.json.classification).toBe('BLOCKED_ENVIRONMENT');
    expect(result.json.reason_code).toBe('COMMAND_BLOCKED');
  });
});
