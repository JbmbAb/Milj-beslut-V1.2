import { mkdtempSync } from 'node:fs';
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
    schema_version: 'dev-gov-v0-evidence',
    unit: manifest.unit,
    kind: 'RED',
    test_id: 'path-lock-red',
    base_sha: manifest.base_sha,
    head_sha: manifest.base_sha,
    manifest_hash: manifestHash(manifest),
    command: 'node red.js',
    cwd: process.cwd(),
    exit_code: 1,
    classification: RESULT.FAIL,
    timestamp: '2026-09-01T10:00:00.000Z',
    stdout_sha256: 'a'.repeat(64),
    stderr_sha256: 'b'.repeat(64),
    ...overrides,
  };
}

describe('DEV-GOV-V0 RED to GREEN gate', () => {
  it('denies GREEN without a matching RED for the same unit/base/test-id/manifest', () => {
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      classification: RESULT.PASS,
      timestamp: '2026-09-01T11:00:00.000Z',
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
      timestamp: '2026-09-01T11:00:00.000Z',
    });

    expect(evaluateEvidenceGate(manifest, [red, green], manifest.target_sha).result).toBe(
      RESULT.DENIED_GOVERNANCE,
    );
  });

  it('denies GREEN evidence that ran before RED', () => {
    const red = evidence({ timestamp: '2026-09-01T12:00:00.000Z' });
    const green = evidence({
      kind: 'GREEN',
      test_id: 'path-lock-green',
      head_sha: manifest.target_sha,
      classification: RESULT.PASS,
      timestamp: '2026-09-01T11:00:00.000Z',
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
      timestamp: '2026-09-01T11:00:00.000Z',
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
      timestamp: '2026-09-01T11:00:00.000Z',
    });

    expect(evaluateEvidenceGate(manifest, [red, green], manifest.target_sha).result).toBe(RESULT.PASS);
  });

  it('finalizes evidence as immutable files bound to the manifest hash and HEAD SHA', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devgov-evidence-'));
    const record = evidence();

    const file = writeEvidence(manifest, record, root);
    await expect(readFile(file, 'utf8')).resolves.toContain(`"manifest_hash":"${manifestHash(manifest)}"`);
    await expect(readFile(file, 'utf8')).resolves.toContain(`"head_sha":"${manifest.base_sha}"`);

    expect(() => writeEvidence(manifest, record, root)).toThrow(/immutable evidence already exists/);
  });

  it('records command classification without collapsing blocked environment into FAIL', () => {
    const exitCommand =
      process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/d', '/c', 'exit', '77'] }
        : { command: 'sh', args: ['-c', 'exit 77'] };
    const failCommand =
      process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/d', '/c', 'exit', '1'] }
        : { command: 'sh', args: ['-c', 'exit 1'] };
    const blocked = runManifestCommand(
      manifest,
      {
        id: 'blocked-command',
        ...exitCommand,
        blocked_exit_codes: [77],
      },
      'RED',
    );
    const failed = runManifestCommand(manifest, { id: 'failed-command', ...failCommand }, 'RED');

    expect(blocked.classification).toBe(RESULT.BLOCKED_ENVIRONMENT);
    expect(failed.classification).toBe(RESULT.FAIL);
    expect(blocked.manifest_hash).toBe(manifestHash(manifest));
    expect(failed.base_sha).toBe(manifest.base_sha);
  });
});
