import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const attestPath = resolve(process.cwd(), '.github/workflows/devgov-v0-attest.yml');
const gatePath = resolve(process.cwd(), '.github/workflows/devgov-v0-gate.yml');
const orchestratorPath = resolve(process.cwd(), '.github/workflows/devgov-v0-orchestrate.yml');

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
    expect(executeProof.env.GITHUB_WORKFLOW_REF).toBe('${{ job.workflow_ref }}');
    expect(signAttestation.env.GITHUB_WORKFLOW_REF).toBe('${{ job.workflow_ref }}');
    expect(source).not.toContain('CANONICAL_ATTEST_WORKFLOW_REF');
    expect(source).not.toContain('export GITHUB_WORKFLOW_REF=');
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

  it('does not give the orchestrator signer or promoter credentials', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(source).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(source).not.toContain('DEVGOV_PROMOTER_PRIVATE_KEY_PEM');
    expect(source).not.toContain('devgov-promote.yml');
    expect(source).not.toContain('git push');
    expect(workflow.jobs.red.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.green.permissions).toEqual({ contents: 'read' });
  });

  it('publishes a machine-readable GATE_PASSED handoff only after the canonical gate succeeds', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(workflow.jobs.state.needs).toEqual(['plan', 'red', 'green', 'gate']);
    expect(source).toContain("schema_version: 'dev-gov-orchestration-state-v1'");
    expect(source).toContain("state: 'GATE_PASSED'");
    expect(source).toContain('devgov-orchestration-${{ inputs.candidate_sha }}');
  });
});
