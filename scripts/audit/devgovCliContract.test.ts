import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

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

function runCli(args) {
  const result = spawnSync(process.execPath, [devgovCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
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
  it('denies forged evidence against a nonexistent worktree before evidence content matters', () => {
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
    const forged = [
      {
        schema_version: 'dev-gov-v0-execution-evidence',
        produced_by: 'devgov-v0',
        tool_version: 'dev-gov-v0.3',
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
    const evidenceFile = writeJson(root, 'evidence.jsonl', {
      schema_version: 'dev-gov-v0-execution-evidence',
      produced_by: 'devgov-v0',
      tool_version: 'dev-gov-v0.3',
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
    });

    const result = runCli(['evidence-gate', '--manifest', manifestFile, '--evidence', evidenceFile]);

    expect(result.status).toBe(4);
    expect(result.json.classification).toBe('DENIED_GOVERNANCE');
    expect(result.json.reason_code).toBe('REPOSITORY_STATE_DENIED');
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
