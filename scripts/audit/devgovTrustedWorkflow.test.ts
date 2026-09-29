import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-attest.yml');
const gateWorkflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-gate.yml');
const orchestratorWorkflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-orchestrate.yml');

describe('DEV-GOV-V0 protected execution workflow', () => {
  // V1-THROUGHPUT (one-approval signing): devgov-v0-attest.yml now holds only execute: -- no
  // per-check signing job, no environment, no key. Signing moved to a same-run sign: job in
  // devgov-v0-orchestrate.yml, the ONE environment-protected click per candidate. See the
  // corresponding assertions on the orchestrator's sign: job below.
  it('keeps execution unprotected and grants it no signer authority', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = parse(source);

    expect(Object.keys(workflow.jobs)).toEqual(['execute']);
    expect(workflow.jobs.execute.environment).toBeUndefined();
    expect(JSON.stringify(workflow.jobs.execute)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(workflow.jobs.execute)).not.toContain('devgov-attestation');
    expect(JSON.stringify(workflow.jobs.execute)).toContain('persist-credentials');
  });

  it('signs on a same-run, environment-protected job in the orchestrator, not the reusable attest workflow', () => {
    const source = readFileSync(orchestratorWorkflowPath, 'utf8');
    const workflow = parse(source);
    const sign = workflow.jobs.sign;

    expect(sign).toBeTruthy();
    expect(sign.needs).toEqual(['plan', 'invariant-packs', 'red', 'green']);
    expect(sign.environment).toBe('devgov-attestation');
    expect(workflow.jobs.gate.needs).toContain('sign');
    expect(JSON.stringify(sign)).toContain('secrets.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(sign)).toContain('persist-credentials');
    // No other orchestrator job may hold environment/secret access -- DG-IP-002 enforces this at
    // the controller level too (scripts/devgov/invariant-packs.mjs); this test pins the same
    // property directly against the YAML so a future edit that widens it fails here first.
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name === 'sign') continue;
      expect(JSON.stringify(job)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
      expect(JSON.stringify(job)).not.toContain('devgov-attestation');
    }
    // execute: (inside devgov-v0-attest.yml, called via red:/green:) never used the signer
    // secrets, so red:/green: no longer need secrets: inherit -- narrower than before.
    expect(workflow.jobs.red.secrets).toBeUndefined();
    expect(workflow.jobs.green.secrets).toBeUndefined();
  });

  it('signs every declared proof id from the verified unit definition, not a shell-templated loop', () => {
    const source = readFileSync(orchestratorWorkflowPath, 'utf8');
    const workflow = parse(source);
    const sign = workflow.jobs.sign.steps.find(
      (step) => step.name === 'Sign trusted execution attestations',
    );

    expect(source).toContain('node controller/scripts/devgov/devgov.mjs attest-all');
    expect(sign.run).toContain('--records-root "$RUNNER_TEMP/devgov-unsigned"');
    expect(sign.run).toContain('--output-dir "$RUNNER_TEMP/devgov-signed"');
    // No ${{ }} expression may be spliced directly into this (or any) run: block -- DG-IP-009
    // enforces this at the controller level; pinned here too.
    expect(sign.run).not.toMatch(/\$\{\{/);
  });

  it('exposes no standalone dispatch entry point -- workflow_call is the only trigger', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = parse(source);

    expect(workflow.on.workflow_call).toBeTruthy();
    expect(workflow.on.workflow_dispatch).toBeUndefined();
    expect(Object.keys(workflow.on)).toEqual(['workflow_call']);
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
    expect(source).toContain('node controller/scripts/devgov/devgov.mjs resolve-execution-sha');
    expect(source).toContain('--candidate-sha "$CANDIDATE_SHA"');
    expect(source).toContain('--definition-worktree candidate');
    expect(source).toContain('test "$DISPATCH_REF" = "refs/heads/$DEFAULT_BRANCH"');
  });

  it('publishes the signed attestations without making the unsigned records authoritative', () => {
    const executeWorkflow = parse(readFileSync(workflowPath, 'utf8'));
    const executeUpload = executeWorkflow.jobs.execute.steps.find(
      (step) => step.name === 'Upload unsigned execution record',
    );
    // Retention on the unsigned record was raised from 1 day to 5: signing now waits on RED and
    // GREEN execution PLUS one human approval, a longer window than the old per-check design.
    expect(executeUpload.with['retention-days']).toBe(5);

    const orchestratorWorkflow = parse(readFileSync(orchestratorWorkflowPath, 'utf8'));
    const redUpload = orchestratorWorkflow.jobs.sign.steps.find(
      (step) => step.name === 'Upload signed RED attestations',
    );
    const greenUpload = orchestratorWorkflow.jobs.sign.steps.find(
      (step) => step.name === 'Upload signed GREEN attestations',
    );
    for (const upload of [redUpload, greenUpload]) {
      expect(upload.with.overwrite).toBe(false);
      expect(upload.with['retention-days']).toBe(90);
      expect(upload.with['if-no-files-found']).toBe('error');
    }
    expect(redUpload.with.name).toBe('devgov-attestation-RED-${{ github.event.client_payload.candidate_sha }}');
    expect(greenUpload.with.name).toBe('devgov-attestation-GREEN-${{ github.event.client_payload.candidate_sha }}');
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
    expect(source).toContain('Verify controller-owned invariant packs');
    expect(source).toContain('node controller/scripts/devgov/invariant-packs.mjs');
    expect(source).toContain('--target candidate');
    expect(source.indexOf('Verify controller-owned invariant packs')).toBeLessThan(
      source.indexOf('Obtain protected gate identity'),
    );
    expect(source).toContain('Upload invariant-pack report');
    expect(source).toContain('devgov-invariant-packs-${{ github.event.client_payload.candidate_sha }}');
  });

  it('checks out the exact candidate without executing candidate-controlled code', () => {
    const source = readFileSync(gateWorkflowPath, 'utf8');

    expect(source).toContain('ref: ${{ github.sha }}');
    expect(source).toContain('ref: ${{ github.event.client_payload.candidate_sha }}');
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

    expect(source).toContain('run-id: ${{ github.event.client_payload.red_run_id }}');
    expect(source).toContain('run-id: ${{ github.event.client_payload.green_run_id }}');
    expect(source).toContain('pattern: devgov-attestation-RED-*');
    expect(source).toContain('pattern: devgov-attestation-GREEN-*');
    expect(source).toContain('repos/$GITHUB_REPOSITORY/statuses/$CANDIDATE_SHA');
    expect(source).toContain("context='DEV-GOV-V0 / trusted-execution'");
    expect(source).toContain('continue-on-error: true');
    expect(source).toContain('test "$GATE_OUTCOME" = success');
  });

  it('exposes no candidate-selectable dispatch entry point on the protected controller workflows', () => {
    const gateWorkflow = parse(readFileSync(gateWorkflowPath, 'utf8'));
    const orchestratorWorkflow = parse(readFileSync(orchestratorWorkflowPath, 'utf8'));

    expect(gateWorkflow.on.workflow_dispatch).toBeUndefined();
    expect(gateWorkflow.on.repository_dispatch).toBeTruthy();
    expect(Object.keys(gateWorkflow.on)).toEqual(['repository_dispatch']);

    expect(orchestratorWorkflow.on.workflow_dispatch).toBeUndefined();
    expect(orchestratorWorkflow.on.repository_dispatch).toBeTruthy();
    expect(Object.keys(orchestratorWorkflow.on)).toEqual(['repository_dispatch']);
  });
});
