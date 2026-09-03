import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-attest.yml');
const gateWorkflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-gate.yml');

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
    expect(source).toContain('chown -R devgov-candidate:devgov-candidate "$execution_root/node_modules"');
    expect(source).toContain('--run-as-uid "$candidate_uid"');
    expect(source).toContain('--run-as-gid "$candidate_gid"');
    expect(source).toContain('--run-as-home /home/devgov-candidate');
    expect(source).toContain('$RUNNER_TEMP/devgov-controller/execution-record.json');
    expect(source).toContain('$RUNNER_TEMP/devgov-export/execution-record.json');
  });

  it('installs dependencies from the canonical exact execution checkout root', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'));
    const prepare = workflow.jobs.execute.steps.find(
      (step) => step.name === 'Prepare isolated proof OS identity',
    );

    expect(prepare.run).toContain('node controller/scripts/devgov/verify-execution-root.mjs');
    expect(prepare.run).toContain('--workspace "$GITHUB_WORKSPACE"');
    expect(prepare.run).toContain('--execution "$GITHUB_WORKSPACE/execution"');
    expect(prepare.run).toContain(
      'sudo -u devgov-candidate npm ci --prefix "$execution_root" --ignore-scripts',
    );
    expect(prepare.run).not.toContain('npm ci --prefix execution');
  });

  it('checks out and executes the exact requested SHA with protected controller code', () => {
    const source = readFileSync(workflowPath, 'utf8');

    expect(source).toContain('ref: ${{ inputs.candidate_sha }}');
    expect(source).toContain('test "$(git -C candidate rev-parse HEAD)" = "$EXPECTED_SHA"');
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs execute-proof');
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs attest-execution');
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs resolve-execution-sha');
    expect(source).toContain('--candidate-sha "$CANDIDATE_SHA"');
    expect(source).toContain('--definition-worktree candidate');
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

describe('DEV-GOV-V0 verifier-owned evidence gate workflow', () => {
  it('anchors trust policy provenance in the protected default-branch gate identity', () => {
    const source = readFileSync(gateWorkflowPath, 'utf8');
    const workflow = parse(source);
    const gate = workflow.jobs['evidence-gate'];

    expect(workflow.permissions).toMatchObject({
      actions: 'read',
      contents: 'read',
      'id-token': 'write',
      statuses: 'write',
    });
    expect(gate.environment).toBe('devgov-attestation');
    expect(source).toContain('test "$DISPATCH_REF" = "refs/heads/$DEFAULT_BRANCH"');
    expect(source).toContain('DEVGOV_VERIFIER_TRUST_POLICY_JSON');
    expect(source).toContain('secrets.DEVGOV_VERIFIER_TRUST_POLICY_JSON');
    expect(source).toContain('audience="devgov-v0-gate:$policy_sha:$CANDIDATE_SHA"');
    expect(source).toContain('printf \'%s\' "$DEVGOV_VERIFIER_TRUST_POLICY_JSON" | sha256sum');
    expect(source).not.toContain('--trust-policy');
  });

  it('checks out the exact candidate without executing candidate-controlled code', () => {
    const source = readFileSync(gateWorkflowPath, 'utf8');

    expect(source).toContain('ref: ${{ github.sha }}');
    expect(source).toContain('ref: ${{ inputs.candidate_sha }}');
    expect(source).toContain('test "$(git -C candidate rev-parse HEAD)" = "$CANDIDATE_SHA"');
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs evidence-gate');
    expect(source).toContain('--definition "candidate/$UNIT_DEFINITION_PATH"');
    expect(source).toContain('--candidate-sha "$CANDIDATE_SHA"');
    expect(source).toContain('DEVGOV_CONTROLLER_SHA: ${{ github.sha }}');
    expect(source).not.toContain('devgov-manifest.json');
    expect(source).not.toContain('require(process.argv[1])');
    expect(source).not.toMatch(/node\s+candidate\//);
    expect(source).not.toMatch(/npm\s+(?:ci|run|test)[^\n]*candidate/);
  });

  it('uses protected attestation artifacts and publishes a status for the exact candidate SHA', () => {
    const source = readFileSync(gateWorkflowPath, 'utf8');

    expect(source).toContain('run-id: ${{ inputs.red_run_id }}');
    expect(source).toContain('run-id: ${{ inputs.green_run_id }}');
    expect(source).toContain('pattern: devgov-attestation-RED-*');
    expect(source).toContain('pattern: devgov-attestation-GREEN-*');
    expect(source).toContain('repos/$GITHUB_REPOSITORY/statuses/$CANDIDATE_SHA');
    expect(source).toContain("context='DEV-GOV-V0 / trusted-execution'");
    expect(source).toContain('continue-on-error: true');
    expect(source).toContain('test "$GATE_OUTCOME" = success');
  });
});
