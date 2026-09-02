import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-attest.yml');

describe('DEV-GOV-V0 protected execution workflow', () => {
  it('keeps execution and signing authority on separate runner jobs', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = parse(source);
    const execute = workflow.jobs.execute;
    const attest = workflow.jobs.attest;

    expect(attest.needs).toBe('execute');
    expect(attest.environment).toBe('devgov-attestation');
    expect(JSON.stringify(execute)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(attest)).toContain('secrets.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(execute)).toContain('persist-credentials');
    expect(JSON.stringify(attest)).toContain('persist-credentials');
  });

  it('runs candidate code under a separate OS identity that cannot rewrite the raw record', () => {
    const source = readFileSync(workflowPath, 'utf8');

    expect(source).toContain('useradd --system --create-home --shell /usr/sbin/nologin devgov-candidate');
    expect(source).toContain('install -d -m 0700 -o root -g root');
    expect(source).toContain('chown -R root:root candidate');
    expect(source).toContain('chmod -R a-w candidate');
    expect(source).toContain('chown -R devgov-candidate:devgov-candidate candidate/node_modules');
    expect(source).toContain('--run-as-uid "$candidate_uid"');
    expect(source).toContain('--run-as-gid "$candidate_gid"');
    expect(source).toContain('--run-as-home /home/devgov-candidate');
    expect(source).toContain('$RUNNER_TEMP/devgov-controller/execution-record.json');
    expect(source).toContain('$RUNNER_TEMP/devgov-export/execution-record.json');
  });

  it('checks out and executes the exact requested SHA with protected controller code', () => {
    const source = readFileSync(workflowPath, 'utf8');

    expect(source).toContain('ref: ${{ inputs.candidate_sha }}');
    expect(source).toContain('test "$(git -C candidate rev-parse HEAD)" = "$EXPECTED_SHA"');
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs execute-proof');
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs attest-execution');
    expect(source).toContain('test "$DISPATCH_REF" = "refs/heads/$DEFAULT_BRANCH"');
  });

  it('publishes the signed attestation without making the unsigned record authoritative', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'));
    const executeUpload = workflow.jobs.execute.steps.find(
      (step) => step.name === 'Upload unsigned execution record',
    );
    const attestationUpload = workflow.jobs.attest.steps.find(
      (step) => step.name === 'Publish immutable signed attestation artifact',
    );

    expect(executeUpload.with['retention-days']).toBe(1);
    expect(attestationUpload.with.overwrite).toBe(false);
    expect(attestationUpload.with['retention-days']).toBe(90);
  });
});
