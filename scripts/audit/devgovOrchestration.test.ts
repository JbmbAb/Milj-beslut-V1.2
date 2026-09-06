import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const attestPath = resolve(process.cwd(), '.github/workflows/devgov-v0-attest.yml');
const gatePath = resolve(process.cwd(), '.github/workflows/devgov-v0-gate.yml');
const orchestratorPath = resolve(process.cwd(), '.github/workflows/devgov-v0-orchestrate.yml');
const unitsReadmePath = resolve(process.cwd(), 'governance/devgov/units/README.md');

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('DEV-GOV-V0 multi-proof orchestration', () => {
  it('keeps the attestation workflow reusable without widening signer authority', () => {
    const source = readFileSync(attestPath, 'utf8');
    const workflow = parse(source);
    const executeProof = workflow.jobs.execute.steps.find(
      (step: { name?: string }) => step.name === 'Execute declared proof command',
    );
    const signAttestation = workflow.jobs.attest.steps.find(
      (step: { name?: string }) => step.name === 'Sign trusted execution attestation',
    );

    expect(workflow.on.workflow_call).toBeTruthy();
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.execute.environment).toBeUndefined();
    expect(workflow.jobs.attest.environment).toBe('devgov-attestation');
    expect(JSON.stringify(workflow.jobs.execute)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(workflow.jobs.attest)).toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(executeProof.env.DEVGOV_JOB_WORKFLOW_REF).toBe('${{ job.workflow_ref }}');
    expect(signAttestation.env.DEVGOV_JOB_WORKFLOW_REF).toBe('${{ job.workflow_ref }}');
    expect(executeProof.env.GITHUB_WORKFLOW_REF).toBeUndefined();
    expect(signAttestation.env.GITHUB_WORKFLOW_REF).toBeUndefined();
    expect(executeProof.run).toContain('export GITHUB_WORKFLOW_REF="$DEVGOV_JOB_WORKFLOW_REF"');
    expect(signAttestation.run).toContain('export GITHUB_WORKFLOW_REF="$DEVGOV_JOB_WORKFLOW_REF"');
    expect(source).not.toContain('CANONICAL_ATTEST_WORKFLOW_REF');
    expect(source).not.toContain('DEVGOV_JOB_WORKFLOW_REF: ${{ github.repository }}');
  });

  it('keeps the trusted gate as a standalone protected workflow and consumes the complete proof set', () => {
    const source = readFileSync(gatePath, 'utf8');
    const workflow = parse(source);
    const gate = workflow.jobs['evidence-gate'];
    const verify = gate.steps.find(
      (step: { name?: string }) => step.name === 'Verify trusted execution attestations',
    );

    expect(workflow.on.workflow_call).toBeUndefined();
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(gate.environment).toBe('devgov-attestation');
    expect(source).toContain('attestation_run_id');
    expect(source).toContain('run-id: ${{ inputs.attestation_run_id }}');
    expect(source).toContain('pattern: devgov-attestation-RED-*');
    expect(source).toContain('pattern: devgov-attestation-GREEN-*');
    expect(verify.run).toContain('test "${#red[@]}" -eq "$EXPECTED_RED_COUNT"');
    expect(verify.run).toContain('test "${#green[@]}" -eq "$EXPECTED_GREEN_COUNT"');
    expect(verify.run).toContain('attestation_args+=(--attestation "$file")');
    expect(verify.run).toContain('node controller/scripts/devgov/devgov.mjs evidence-gate');
  });

  it('binds the orchestration run into the gate and emits the signed verdict only on that path', () => {
    const source = readFileSync(gatePath, 'utf8');
    const workflow = parse(source);
    const steps: Array<Record<string, any>> = workflow.jobs['evidence-gate'].steps;
    const verify = steps.find((step) => step.name === 'Verify trusted execution attestations');
    const verdict = steps.find((step) => step.name === 'Publish signed gate verdict artifact');
    const publish = steps.find((step) => step.name === 'Publish exact candidate gate result');

    expect(workflow.on.workflow_dispatch.inputs.controller_dispatch_binding).toMatchObject({
      required: false,
      type: 'string',
    });
    expect(verify.id).toBe('gate');
    expect(verify.env.DEVGOV_ATTESTATION_RUN_ID).toBe('${{ inputs.attestation_run_id }}');
    expect(verify.env.DEVGOV_CONTROLLER_DISPATCH_BINDING).toBe('${{ inputs.controller_dispatch_binding }}');
    expect(verify.env.DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM).toBe(
      '${{ secrets.DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM }}',
    );
    expect(verify.env.DEVGOV_GATE_VERDICT_ISSUER).toBe('${{ vars.DEVGOV_GATE_VERDICT_ISSUER }}');
    expect(verify.env.DEVGOV_GATE_VERDICT_KEY_ID).toBe('${{ vars.DEVGOV_GATE_VERDICT_KEY_ID }}');
    expect(verify.run).toContain('if [ -n "$DEVGOV_ATTESTATION_RUN_ID" ]');
    expect(verify.run).toContain('--verdict-output "$RUNNER_TEMP/devgov-gate-verdict/gate-verdict.json"');
    expect(verify.run).toContain('"${verdict_args[@]}"');

    expect(verdict.id).toBe('verdict');
    expect(verdict.uses).toBe('actions/upload-artifact@v4');
    expect(verdict.if).toBe("steps.gate.outcome == 'success' && inputs.attestation_run_id != ''");
    expect(verdict.with.name).toBe(
      'devgov-gate-verdict-${{ inputs.candidate_sha }}-${{ inputs.attestation_run_id }}',
    );
    expect(verdict.with.overwrite).toBe(false);
    expect(verdict.with['if-no-files-found']).toBe('error');
    expect(verdict['continue-on-error']).toBeUndefined();

    expect(steps.indexOf(verify)).toBeLessThan(steps.indexOf(verdict));
    expect(steps.indexOf(verdict)).toBeLessThan(steps.indexOf(publish));
    expect(publish.env.VERDICT_OUTCOME).toBe('${{ steps.verdict.outcome }}');
    expect(publish.env.ATTESTATION_RUN_ID).toBe('${{ inputs.attestation_run_id }}');
    expect(publish.run).toContain('if [ "$VERDICT_OUTCOME" = success ]; then');
    expect(publish.run).toContain('test "$state" = success');
    expect(publish.run).not.toContain('test "$GATE_OUTCOME" = success');
  });

  it('keeps the gate-verdict and execution-attestation keys in disjoint workflows', () => {
    const attestSource = readFileSync(attestPath, 'utf8');
    const gateSource = readFileSync(gatePath, 'utf8');
    const orchestratorSource = readFileSync(orchestratorPath, 'utf8');

    expect(countOccurrences(gateSource, 'secrets.DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM')).toBe(1);
    expect(gateSource).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(orchestratorSource).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(orchestratorSource).not.toContain('DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM');
    expect(attestSource).not.toContain('DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM');

    const attest = parse(attestSource);
    expect(JSON.stringify(attest.jobs.execute)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(attest.jobs.attest)).toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
  });

  it('derives RED and GREEN matrices from the candidate unit definition and preserves ordering', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.red.uses).toBe('./.github/workflows/devgov-v0-attest.yml');
    expect(workflow.jobs.green.uses).toBe('./.github/workflows/devgov-v0-attest.yml');
    expect(workflow.jobs.red.secrets).toBe('inherit');
    expect(workflow.jobs.green.secrets).toBe('inherit');
    expect(workflow.jobs.green.needs).toEqual(['plan', 'red']);
    expect(workflow.jobs.gate.needs).toEqual(['plan', 'red', 'green']);
    expect(workflow.jobs.gate['runs-on']).toBe('ubuntu-latest');
    expect(JSON.stringify(workflow.jobs.red.strategy.matrix)).toContain('needs.plan.outputs.red_ids');
    expect(JSON.stringify(workflow.jobs.green.strategy.matrix)).toContain('needs.plan.outputs.green_ids');
  });

  it('dispatches the canonical gate instead of trying to reuse its OIDC identity', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);
    const gate = workflow.jobs.gate;

    expect(gate.permissions).toEqual({ actions: 'write', contents: 'read' });
    expect(source).toContain('gh workflow run devgov-v0-gate.yml');
    expect(source).toContain('-f attestation_run_id="$ATTESTATION_RUN_ID"');
    expect(source).toContain('gh run watch "$gate_run_id" --exit-status');
    expect(source).not.toContain('uses: ./.github/workflows/devgov-v0-gate.yml');
  });

  it('forwards the controller dispatch binding unchanged to the gate and nowhere else', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);
    const binding = workflow.on.workflow_dispatch.inputs.controller_dispatch_binding;
    const dispatch = workflow.jobs.gate.steps.find(
      (step: { name?: string }) => step.name === 'Dispatch canonical gate as its own protected workflow run',
    );

    expect(binding).toBeTruthy();
    expect(binding.required).toBe(true);
    expect(binding.type).toBe('string');
    expect(dispatch.env.CONTROLLER_DISPATCH_BINDING).toBe('${{ inputs.controller_dispatch_binding }}');
    expect(dispatch.run).toContain('-f controller_dispatch_binding="$CONTROLLER_DISPATCH_BINDING"');

    // The binding is gate-only input; it never reaches the reusable attest
    // calls, the plan, the promoter or the closed-state publisher.
    expect(JSON.stringify(workflow.jobs.red)).not.toContain('controller_dispatch_binding');
    expect(JSON.stringify(workflow.jobs.green)).not.toContain('controller_dispatch_binding');
    expect(JSON.stringify(workflow.jobs.plan)).not.toContain('controller_dispatch_binding');
    expect(JSON.stringify(workflow.jobs.promote)).not.toContain('controller_dispatch_binding');
    expect(JSON.stringify(workflow.jobs.state)).not.toContain('controller_dispatch_binding');
    expect(JSON.stringify(workflow.jobs.plan)).not.toContain('DEVGOV_GATE_VERDICT');
    expect(JSON.stringify(workflow.jobs.state)).not.toContain('DEVGOV_GATE_VERDICT');
  });

  it('correlates only a new canonical gate run for the same protected controller revision', () => {
    const workflow = parse(readFileSync(orchestratorPath, 'utf8'));
    const gate = workflow.jobs.gate;
    const dispatch = gate.steps.find(
      (step: { name?: string }) => step.name === 'Dispatch canonical gate as its own protected workflow run',
    );
    const resolveRun = gate.steps.find(
      (step: { name?: string }) => step.name === 'Resolve and wait for the exact canonical gate run',
    );

    expect(dispatch.id).toBe('dispatch_gate');
    expect(dispatch.run).toContain('preexisting_gate_run_ids');
    expect(dispatch.run).toContain(
      'echo "preexisting_gate_run_ids=$preexisting_gate_run_ids" >> "$GITHUB_OUTPUT"',
    );
    expect(resolveRun.env.PREEXISTING_GATE_RUN_IDS).toBe(
      '${{ steps.dispatch_gate.outputs.preexisting_gate_run_ids }}',
    );
    expect(resolveRun.env.DEFAULT_BRANCH).toBe('${{ github.event.repository.default_branch }}');
    expect(resolveRun.env.CONTROLLER_SHA).toBe('${{ github.sha }}');
    expect(resolveRun.run).toContain("r.event==='workflow_dispatch'");
    expect(resolveRun.run).toContain('r.head_branch===branch');
    expect(resolveRun.run).toContain('r.head_sha===sha');
    expect(resolveRun.run).toContain('!before.has(String(r.id))');
    expect(resolveRun.run).toContain('if (hits.length>1)');
    expect(resolveRun.run).toContain("process.stdout.write('AMBIGUOUS:'");
    expect(resolveRun.run).toContain('multiple new canonical gate runs matched this dispatch');
    expect(resolveRun.run).toContain('new canonical gate run was not found for the protected controller SHA');
  });

  it('keeps signer and promoter authority isolated to their dedicated jobs', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(source).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(workflow.jobs.plan)).not.toContain('DEVGOV_PROMOTER');
    expect(JSON.stringify(workflow.jobs.red)).not.toContain('DEVGOV_PROMOTER');
    expect(JSON.stringify(workflow.jobs.green)).not.toContain('DEVGOV_PROMOTER');
    expect(JSON.stringify(workflow.jobs.gate)).not.toContain('DEVGOV_PROMOTER');
    expect(workflow.jobs.promote.environment).toBe('devgov-promoter');
    expect(JSON.stringify(workflow.jobs.promote)).toContain('DEVGOV_PROMOTER_PRIVATE_KEY_PEM');
  });

  it('publishes PROMOTED only after the canonical gate and promoter succeed', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(workflow.jobs.promote.needs).toEqual(['plan', 'gate']);
    expect(workflow.jobs.state.needs).toEqual(['plan', 'red', 'green', 'gate', 'promote']);
    expect(source).toContain("schema_version: 'dev-gov-orchestration-state-v1'");
    expect(source).toContain("state: 'PROMOTED'");
    expect(source).toContain('devgov-orchestration-${{ inputs.candidate_sha }}');
  });
});

describe('DEV-GOV-V0 units README documents the signed gate verdict contract', () => {
  it('names the verdict schema, artifact, dedicated key, binding and authority boundary', () => {
    const readme = readFileSync(unitsReadmePath, 'utf8');

    expect(readme).toContain('dev-gov-v1-gate-verdict');
    expect(readme).toContain('devgov-gate-verdict-<candidate_sha>-<orchestration_run_id>');
    expect(readme).toContain('DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM');
    expect(readme).toContain('controller_dispatch_binding');
    expect(readme).toContain('transport and discovery, not authority retention');
  });

  it('marks the legacy single-proof commit status as non-authoritative and never proof', () => {
    const readme = readFileSync(unitsReadmePath, 'utf8');

    expect(readme).toContain('no consumer may treat a legacy or manual gate run as proof');
    expect(readme).toContain('non-authoritative');
  });
});
