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

    expect(workflow.on.workflow_call).toBeTruthy();
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.execute.environment).toBeUndefined();
    expect(workflow.jobs.attest.environment).toBe('devgov-attestation');
    expect(JSON.stringify(workflow.jobs.execute)).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(JSON.stringify(workflow.jobs.attest)).toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
  });

  it('makes the gate reusable and passes every required signed attestation to the canonical CLI', () => {
    const source = readFileSync(gatePath, 'utf8');
    const workflow = parse(source);
    const gate = workflow.jobs['evidence-gate'];
    const verify = gate.steps.find((step: { name?: string }) => step.name === 'Verify trusted execution attestations');

    expect(workflow.on.workflow_call).toBeTruthy();
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(gate.environment).toBe('devgov-attestation');
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
    expect(workflow.jobs.gate.uses).toBe('./.github/workflows/devgov-v0-gate.yml');
    expect(workflow.jobs.green.needs).toEqual(['plan', 'red']);
    expect(workflow.jobs.gate.needs).toEqual(['plan', 'red', 'green']);
    expect(JSON.stringify(workflow.jobs.red.strategy.matrix)).toContain('needs.plan.outputs.red_ids');
    expect(JSON.stringify(workflow.jobs.green.strategy.matrix)).toContain('needs.plan.outputs.green_ids');
  });

  it('does not give the orchestrator signer or promoter credentials and only grants status authority to the gate call', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(source).not.toContain('DEVGOV_ATTESTATION_PRIVATE_KEY_PEM');
    expect(source).not.toContain('DEVGOV_PROMOTER_PRIVATE_KEY_PEM');
    expect(source).not.toContain('devgov-promote.yml');
    expect(source).not.toContain('git push');
    expect(workflow.jobs.red.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.green.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.gate.permissions).toMatchObject({
      actions: 'read',
      contents: 'read',
      'id-token': 'write',
      statuses: 'write',
    });
  });

  it('publishes a machine-readable GATE_PASSED handoff only after the gate succeeds', () => {
    const source = readFileSync(orchestratorPath, 'utf8');
    const workflow = parse(source);

    expect(workflow.jobs.state.needs).toEqual(['plan', 'red', 'green', 'gate']);
    expect(source).toContain("schema_version: 'dev-gov-orchestration-state-v1'");
    expect(source).toContain("state: 'GATE_PASSED'");
    expect(source).toContain('devgov-orchestration-${{ inputs.candidate_sha }}');
  });
});
