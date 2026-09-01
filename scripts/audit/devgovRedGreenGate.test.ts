import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateEvidenceGate,
  manifestHash,
  RESULT,
  runManifestCommand,
  writeEvidence,
} from '../devgov/devgov.mjs';

const manifest = {
  schema_version: 'dev-gov-v0',
  unit: 'DEV-GOV-V0-RED-GREEN',
  role: 'producer',
  mode: 'writer',
  worktree: process.cwd(),
  branch: 'codex/dev-gov-v0-test',
  base_sha: '1'.repeat(40),
  target_sha: '2'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['server/**'],
  required_red: [{ id: 'path-lock-red', command: 'node', expected_classification: 'FAIL' }],
  required_green: [{ id: 'path-lock-green', command: 'node' }],
};

function evidence(overrides = {}) {
  return {
    schema_version: 'dev-gov-v0-execution-evidence',
    produced_by: 'devgov-v0',
    tool_version: 'dev-gov-v0.2',
    execution_nonce: 'nonce-1',
    unit: manifest.unit,
    kind: 'RED',
    test_id: 'path-lock-red',
    base_sha: manifest.base_sha,
    head_sha: manifest.base_sha,
    manifest_hash: manifestHash(manifest),
    command: 'node',
    cwd: process.cwd(),
    started_at: '2026-09-01T10:00:00.000Z',
    finished_at: '2026-09-01T10:00:01.000Z',
    exit_code: 1,
    classification: RESULT.FAIL,
    environment_error: '',
    stdout_sha256: 'a'.repeat(64),
    stderr_sha256: 'b'.repeat(64),
    ...overrides,
  };
}

function cleanGitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'devgov-run-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'devgov@example.invalid']);
  git(['config', 'user.name', 'DEV-GOV Test']);
  writeFileSync(join(root, 'file.txt'), 'initial\n');
  git(['add', 'file.txt']);
  git(['commit', '-m', 'initial']);
  return root;
}

function manifestForRepo(root) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return {
    ...manifest,
    worktree: root,
    branch: 'main',
    base_sha: head,
    target_sha: head,
    allowed_paths: ['**/*'],
    forbidden_paths: [],
  };
}

describe('DEV-GOV-V0 RED to GREEN gate', () => {
  it('denies GREEN without a matching RED for the same unit/base/test-id/manifest', () => {
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      classification: RESULT.PASS,
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    });

    const result = evaluateEvidenceGate(manifest, [green], manifest.target_sha);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('missing valid RED evidence for path-lock-red');
  });

  it('denies stale RED evidence from another base', () => {
    const red = evidence({ base_sha: '9'.repeat(40) });
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      classification: RESULT.PASS,
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    });

    expect(evaluateEvidenceGate(manifest, [red, green], manifest.target_sha).result).toBe(
      RESULT.DENIED_GOVERNANCE,
    );
  });

  it('denies GREEN evidence that ran before RED', () => {
    const red = evidence({
      started_at: '2026-09-01T12:00:00.000Z',
      finished_at: '2026-09-01T12:00:01.000Z',
    });
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      classification: RESULT.PASS,
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    });

    const result = evaluateEvidenceGate(manifest, [red, green], manifest.target_sha);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('missing valid GREEN evidence');
  });

  it('denies GREEN evidence collected on another candidate SHA', () => {
    const red = evidence();
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: '3'.repeat(40),
      classification: RESULT.PASS,
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    });

    expect(evaluateEvidenceGate(manifest, [red, green], manifest.target_sha).result).toBe(
      RESULT.DENIED_GOVERNANCE,
    );
  });

  it('accepts only SHA and manifest-bound RED before GREEN', () => {
    const red = evidence();
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      classification: RESULT.PASS,
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    });

    expect(evaluateEvidenceGate(manifest, [red, green], manifest.target_sha).result).toBe(RESULT.PASS);
  });

  it('denies forged legacy-looking RED/GREEN evidence that was not tool-produced', () => {
    const forgedRed = {
      schema_version: 'dev-gov-v0-evidence',
      unit: manifest.unit,
      kind: 'RED',
      test_id: 'path-lock-red',
      base_sha: manifest.base_sha,
      head_sha: manifest.base_sha,
      manifest_hash: manifestHash(manifest),
      command: 'node',
      cwd: process.cwd(),
      exit_code: 1,
      classification: RESULT.FAIL,
      timestamp: '2026-09-01T10:00:00.000Z',
      stdout_sha256: 'a'.repeat(64),
      stderr_sha256: 'b'.repeat(64),
    };
    const forgedGreen = {
      ...forgedRed,
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      exit_code: 0,
      classification: RESULT.PASS,
      timestamp: '2026-09-01T11:00:00.000Z',
    };

    expect(evaluateEvidenceGate(manifest, [forgedRed, forgedGreen], manifest.target_sha).result).toBe(
      RESULT.DENIED_GOVERNANCE,
    );
  });

  it('finalizes evidence as immutable files bound to the manifest hash and HEAD SHA', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-evidence-'));
    const record = evidence();

    const file = writeEvidence(manifest, record, root);
    const saved = await readFile(file, 'utf8');
    expect(saved).toContain(`"manifest_hash":"${manifestHash(manifest)}"`);
    expect(saved).toContain(`"head_sha":"${manifest.base_sha}"`);
    expect(saved).toContain('"evidence_hash"');

    expect(() => writeEvidence(manifest, record, root)).toThrow(/immutable evidence already exists/);
  });

  it('records command classification without collapsing blocked environment into FAIL', () => {
    const commandManifest = manifestForRepo(cleanGitRepo());
    const exitCommand =
      process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/d', '/c', 'exit', '77'] }
        : { command: 'sh', args: ['-c', 'exit 77'] };
    const failCommand =
      process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/d', '/c', 'exit', '1'] }
        : { command: 'sh', args: ['-c', 'exit 1'] };
    const blocked = runManifestCommand(
      commandManifest,
      {
        id: 'blocked-command',
        ...exitCommand,
        blocked_exit_codes: [77],
      },
      'RED',
    );
    const failed = runManifestCommand(commandManifest, { id: 'failed-command', ...failCommand }, 'RED');

    expect(blocked.classification).toBe(RESULT.BLOCKED_ENVIRONMENT);
    expect(failed.classification).toBe(RESULT.FAIL);
    expect(blocked.manifest_hash).toBe(manifestHash(commandManifest));
    expect(failed.base_sha).toBe(commandManifest.base_sha);
  });

  it('denies run-red/run-green execution on a dirty proof surface', () => {
    const root = cleanGitRepo();
    const commandManifest = manifestForRepo(root);
    writeFileSync(join(root, 'dirty.txt'), 'dirty\n');

    const record = runManifestCommand(
      commandManifest,
      { id: 'dirty-command', command: process.execPath, args: ['-e', 'process.exit(0)'] },
      'RED',
    );

    expect(record.classification).toBe(RESULT.DENIED_GOVERNANCE);
    expect(record.environment_error).toContain('dirty tree rejected');
  });
});
