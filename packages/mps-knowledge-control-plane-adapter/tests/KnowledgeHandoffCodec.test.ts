import { describe, expect, it } from 'vitest';

import { KnowledgeHandoffCodecError, toAgentHandoff } from '../src';
import type { KnowledgeRunResult } from '../src';

const BASE = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const UNIT_HASH = 'c'.repeat(64);
const PROOF_HASH = 'd'.repeat(64);

function run(overrides: Partial<KnowledgeRunResult> = {}): KnowledgeRunResult {
  return {
    agentRunId: 'run-1',
    unitId: 'KNOWLEDGE-TEST-UNIT-1',
    role: 'IMPLEMENTER',
    inputState: 'IMPLEMENTING',
    observedBaseSha: BASE,
    observedCandidateSha: CANDIDATE,
    unitDefinitionHash: UNIT_HASH,
    proofContractHash: PROOF_HASH,
    outcome: 'PASS',
    findings: [],
    outputArtifacts: [],
    startedAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:05:00.000Z',
    ...overrides,
  };
}

describe('toAgentHandoff', () => {
  it('copies the run result verbatim into the AgentHandoff shape', () => {
    const input = run();
    const handoff = toAgentHandoff(input);
    expect(handoff).toEqual({
      agentRunId: input.agentRunId,
      unitId: input.unitId,
      role: input.role,
      inputState: input.inputState,
      observedBaseSha: input.observedBaseSha,
      observedCandidateSha: input.observedCandidateSha,
      unitDefinitionHash: input.unitDefinitionHash,
      proofContractHash: input.proofContractHash,
      result: input.outcome,
      verifierIndependent: input.verifierIndependent,
      findings: input.findings,
      outputArtifacts: input.outputArtifacts,
      requestedNextAction: input.requestedNextAction,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    });
  });

  it('never invents a result: output.result always equals input.outcome, for every outcome', () => {
    const outcomes: KnowledgeRunResult['outcome'][] = [
      'PASS',
      'FAIL',
      'BLOCKED_ENVIRONMENT',
      'BLOCKED_DEPENDENCY',
      'DENIED_GOVERNANCE',
      'CANCELLED',
    ];
    for (const outcome of outcomes) {
      const handoff = toAgentHandoff(run({ outcome }));
      expect(handoff.result).toBe(outcome);
    }
  });

  it('passes findings through with classification/severity untouched', () => {
    const findings = [
      { id: 'F1', severity: 'BLOCKING' as const, classification: 'SEMANTIC' as const, message: 'x' },
      { id: 'F2', severity: 'NON_BLOCKING' as const, classification: 'MECHANICAL' as const, message: 'y' },
    ];
    const handoff = toAgentHandoff(run({ outcome: 'FAIL', findings }));
    expect(handoff.findings).toEqual(findings);
  });

  it('rejects a run result carrying an outcome outside the closed AgentResult union', () => {
    const malformed = { ...run(), outcome: 'MOSTLY_PASSED' } as unknown as KnowledgeRunResult;
    expect(() => toAgentHandoff(malformed)).toThrow(KnowledgeHandoffCodecError);
  });

  it('rejects an unsupported role rather than silently coercing it', () => {
    const malformed = { ...run(), role: 'PROMOTER' } as unknown as KnowledgeRunResult;
    expect(() => toAgentHandoff(malformed)).toThrow(KnowledgeHandoffCodecError);
  });

  it('rejects a VERIFIER PASS that does not declare verifierIndependent: true', () => {
    expect(() =>
      toAgentHandoff(run({ role: 'VERIFIER', outcome: 'PASS', verifierIndependent: false })),
    ).toThrow(KnowledgeHandoffCodecError);
    expect(() => toAgentHandoff(run({ role: 'VERIFIER', outcome: 'PASS' }))).toThrow(
      KnowledgeHandoffCodecError,
    );
  });

  it('accepts a VERIFIER FAIL without requiring verifierIndependent', () => {
    expect(() => toAgentHandoff(run({ role: 'VERIFIER', outcome: 'FAIL' }))).not.toThrow();
  });
});
