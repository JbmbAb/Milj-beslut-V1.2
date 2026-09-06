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

  it('identifies the exact isolation-bootstrap command without tracing command data', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'));
    const prepare = workflow.jobs.execute.steps.find(
      (step) => step.name === 'Prepare isolated proof OS identity',
    );

    expect(prepare.run).toContain('run_isolation_command()');
    expect(prepare.run).toContain('DEVGOV_ISOLATION_START=$label');
    expect(prepare.run).toContain('DEVGOV_ISOLATION_PASS=$label');
    expect(prepare.run).toContain('DEVGOV_FAILED_COMMAND=$label');
    expect(prepare.run).toContain('DEVGOV_FAILED_EXIT=$status');
    expect(prepare.run).not.toContain('set -x');

    for (const invocation of [
      'run_isolation_command useradd sudo useradd --system --create-home --shell /usr/sbin/nologin devgov-candidate',
      'run_isolation_command chown-execution-root sudo chown -R devgov-candidate:devgov-candidate "$execution_root"',
      'run_isolation_command open-runner-home-traverse sudo chmod o+x /home/runner',
      'run_isolation_command read-package-json sudo -u devgov-candidate test -r "$execution_root/package.json"',
      'run_isolation_command read-package-lock-json sudo -u devgov-candidate test -r "$execution_root/package-lock.json"',
      'run_isolation_command npm-ci sudo -u devgov-candidate npm ci --prefix "$execution_root" --ignore-scripts',
      'run_isolation_command freeze-candidate-owner sudo chown -R root:root candidate',
      'run_isolation_command freeze-candidate-mode sudo chmod -R a-w candidate',
      'run_isolation_command freeze-execution-owner sudo chown -R root:root "$execution_root"',
      'run_isolation_command freeze-execution-mode sudo chmod -R a-w "$execution_root"',
      'run_isolation_command restore-node-modules-owner sudo chown -R devgov-candidate:devgov-candidate "$execution_root/node_modules"',
      'run_isolation_command restore-node-modules-mode sudo chmod -R u+w "$execution_root/node_modules"',
      'run_isolation_command safe-directory-candidate sudo git config --global --add safe.directory "$GITHUB_WORKSPACE/candidate"',
      'run_isolation_command safe-directory-execution sudo git config --global --add safe.directory "$GITHUB_WORKSPACE/execution"',
      'run_isolation_command create-controller-dir sudo install -d -m 0700 -o root -g root "$RUNNER_TEMP/devgov-controller"',
      'run_isolation_command create-export-dir install -d -m 0700 "$RUNNER_TEMP/devgov-export"',
    ]) {
      expect(prepare.run).toContain(invocation);
    }
  });

  it('reports parent-directory traversal without changing the fail-closed command', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'));
    const prepare = workflow.jobs.execute.steps.find(
      (step) => step.name === 'Prepare isolated proof OS identity',
    );

    expect(prepare.run).toContain('report_isolation_probe()');
    expect(prepare.run).toContain('DEVGOV_ISOLATION_PROBE_PASS=$label');
    expect(prepare.run).toContain('DEVGOV_ISOLATION_PROBE_FAIL=$label');
    expect(prepare.run).toContain('DEVGOV_ISOLATION_PROBE_EXIT=$status');
    expect(prepare.run).toContain(
      'run_isolation_command open-runner-home-traverse sudo chmod o+x /home/runner',
    );
    expect(prepare.run).toContain(
      'run_isolation_command inspect-package-path namei -l "$execution_root/package.json"',
    );
    expect(prepare.run).toContain(
      'report_isolation_probe traverse-workspace-parent sudo -u devgov-candidate test -x "$workspace_parent"',
    );
    expect(prepare.run).toContain(
      'report_isolation_probe traverse-workspace sudo -u devgov-candidate test -x "$GITHUB_WORKSPACE"',
    );
    expect(prepare.run).toContain(
      'report_isolation_probe traverse-execution-root sudo -u devgov-candidate test -x "$execution_root"',
    );

    const openTraverseIndex = prepare.run.indexOf(
      'run_isolation_command open-runner-home-traverse sudo chmod o+x /home/runner',
    );
    const probeIndex = prepare.run.indexOf('report_isolation_probe traverse-execution-root');
    const terminalReadIndex = prepare.run.indexOf('run_isolation_command read-package-json');
    expect(openTraverseIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(openTraverseIndex);
    expect(terminalReadIndex).toBeGreaterThan(probeIndex);
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
    expect(source).toContain('test "$state" = success');
    expect(source).not.toContain('test "$GATE_OUTCOME" = success');
  });
});

describe('DEV-GOV-V0 signed gate verdict emission', () => {
  const loadGate = () => {
    const source = readFileSync(gateWorkflowPath, 'utf8');
    const workflow = parse(source);
    const steps: Array<Record<string, any>> = workflow.jobs['evidence-gate'].steps;
    const verify = steps.find((step) => step.name === 'Verify trusted execution attestations');
    const verdict = steps.find((step) => step.name === 'Publish signed gate verdict artifact');
    const publish = steps.find((step) => step.name === 'Publish exact candidate gate result');
    return { source, workflow, steps, verify, verdict, publish };
  };

  it('accepts an opaque controller dispatch binding and forwards it verbatim to the verifier', () => {
    const { workflow, verify } = loadGate();
    const binding = workflow.on.workflow_dispatch.inputs.controller_dispatch_binding;

    expect(binding).toBeTruthy();
    expect(binding.required).toBe(false);
    expect(binding.type).toBe('string');
    expect(verify.id).toBe('gate');
    expect(verify.env.DEVGOV_CONTROLLER_DISPATCH_BINDING).toBe('${{ inputs.controller_dispatch_binding }}');
    expect(verify.env.DEVGOV_ATTESTATION_RUN_ID).toBe('${{ inputs.attestation_run_id }}');
    expect(verify.env.DEVGOV_JOB_WORKFLOW_REF).toBe('${{ job.workflow_ref }}');
    expect(verify.env.GITHUB_WORKFLOW_REF).toBeUndefined();
    expect(verify.run).toContain('export GITHUB_WORKFLOW_REF="$DEVGOV_JOB_WORKFLOW_REF"');
    expect(verify.run).toContain('if [ -n "$DEVGOV_ATTESTATION_RUN_ID" ]');
    expect(verify.run).toContain('--verdict-output "$RUNNER_TEMP/devgov-gate-verdict/gate-verdict.json"');
    expect(verify.run).toContain('"${verdict_args[@]}"');
  });

  it('confines the dedicated gate-verdict key to the verify step of the protected gate', () => {
    const { source, steps, verify } = loadGate();

    expect(verify.env.DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM).toBe(
      '${{ secrets.DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM }}',
    );
    expect(verify.env.DEVGOV_GATE_VERDICT_ISSUER).toBe('${{ vars.DEVGOV_GATE_VERDICT_ISSUER }}');
    expect(verify.env.DEVGOV_GATE_VERDICT_KEY_ID).toBe('${{ vars.DEVGOV_GATE_VERDICT_KEY_ID }}');

    const occurrences = source.split('secrets.DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM').length - 1;
    expect(occurrences).toBe(1);
    for (const step of steps) {
      if (step === verify) continue;
      expect(JSON.stringify(step)).not.toContain('DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM');
    }
    expect(verify.run).not.toContain('DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM');

    // The execution-attestation key never reaches the gate; the two keys speak
    // for two different statement classes.
    expect(source).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
  });

  it('never exposes the gate-verdict key to the attestation workflow', () => {
    const attestSource = readFileSync(workflowPath, 'utf8');
    const attest = parse(attestSource);

    expect(attestSource).not.toContain('DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM');
    expect(JSON.stringify(attest.jobs.execute)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(attest.jobs.attest)).toContain('secrets.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
  });

  it('publishes the signed verdict create-once as part of the gate itself', () => {
    const { verdict } = loadGate();

    expect(verdict).toBeTruthy();
    expect(verdict.id).toBe('verdict');
    expect(verdict.uses).toBe('actions/upload-artifact@v4');
    expect(verdict.if).toBe("steps.gate.outcome == 'success' && inputs.attestation_run_id != ''");
    expect(verdict.with.name).toBe(
      'devgov-gate-verdict-${{ inputs.candidate_sha }}-${{ inputs.attestation_run_id }}',
    );
    expect(verdict.with.path).toBe('${{ runner.temp }}/devgov-gate-verdict/gate-verdict.json');
    expect(verdict.with['if-no-files-found']).toBe('error');
    expect(verdict.with.overwrite).toBe(false);
    expect(verdict.with['retention-days']).toBe(90);
    expect(verdict['continue-on-error']).toBeUndefined();
  });

  it('orders verify, verdict upload and status publication so observation never outruns authority', () => {
    const { steps, verify, verdict, publish } = loadGate();
    const verifyIndex = steps.indexOf(verify);
    const verdictIndex = steps.indexOf(verdict);
    const publishIndex = steps.indexOf(publish);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(verdictIndex).toBeGreaterThan(verifyIndex);
    expect(publishIndex).toBeGreaterThan(verdictIndex);

    expect(publish.if).toBe('always()');
    expect(publish.env.VERDICT_OUTCOME).toBe('${{ steps.verdict.outcome }}');
    expect(publish.env.ATTESTATION_RUN_ID).toBe('${{ inputs.attestation_run_id }}');
    expect(publish.env.GATE_OUTCOME).toBe('${{ steps.gate.outcome }}');

    const run: string = publish.run;
    expect(run).toContain('if [ "$VERDICT_OUTCOME" = success ]; then');
    expect(run.trimEnd().endsWith('test "$state" = success')).toBe(true);
    expect(run).not.toContain('test "$GATE_OUTCOME" = success');

    // On the orchestrated path the first state=success after the
    // ATTESTATION_RUN_ID branch opens must be guarded by VERDICT_OUTCOME.
    const orchestratedBranch = run.indexOf('if [ -n "$ATTESTATION_RUN_ID" ]; then');
    expect(orchestratedBranch).toBeGreaterThan(-1);
    const verdictGuard = run.indexOf('if [ "$VERDICT_OUTCOME" = success ]; then', orchestratedBranch);
    const firstSuccess = run.indexOf('state=success', orchestratedBranch);
    expect(verdictGuard).toBeGreaterThan(orchestratedBranch);
    expect(firstSuccess).toBeGreaterThan(verdictGuard);

    // Exactly two success assignments: the verdict-guarded orchestrated branch
    // and the legacy (empty ATTESTATION_RUN_ID) branch after its else.
    const successAssignments = run.split('state=success').length - 1;
    expect(successAssignments).toBe(2);
    const legacyElse = run.indexOf('else', verdictGuard);
    const secondSuccess = run.indexOf('state=success', firstSuccess + 1);
    expect(secondSuccess).toBeGreaterThan(legacyElse);
    expect(run.slice(0, orchestratedBranch)).not.toContain('state=success');
  });

  it('keeps the pending status pending and never pre-announces success', () => {
    const { steps } = loadGate();
    const pending = steps.find((step) => step.name === 'Mark exact candidate gate pending');
    const statusSteps = steps.filter(
      (step) => typeof step.run === 'string' && step.run.includes('/statuses/'),
    );

    expect(statusSteps[0]).toBe(pending);
    expect(pending.run).toContain('-f state=pending');
    expect(pending.run).not.toContain('success');
    expect(pending.run).not.toContain('state=failure');
  });
});
