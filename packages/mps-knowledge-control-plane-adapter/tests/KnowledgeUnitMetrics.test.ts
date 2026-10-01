import { describe, expect, it } from 'vitest';

import {
  AppendOnlyEventLog,
  HandoffIngestor,
  applyControllerActivation,
  routeAfterHandoff,
  type AgentHandoff,
  type MultiAgentUnitState,
} from '@miljobeslut/mps-control-plane';

import { deriveKnowledgeUnitMetrics, summarizeKnowledgeThroughput } from '../src';

const BASE = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const UNIT_HASH = 'c'.repeat(64);
const PROOF_HASH = 'd'.repeat(64);

function seed(unitId: string): MultiAgentUnitState {
  return {
    unitId,
    unitDefinitionHash: UNIT_HASH,
    baseSha: BASE,
    branch: `codex/${unitId.toLowerCase()}`,
    scope: ['packages/mps-knowledge-corpus/**'],
    proofContractHash: PROOF_HASH,
    controllerContractVersion: 'multi-agent-control-plane-v1',
    state: 'IMPLEMENTING',
    revision: 1,
    updatedAt: '2026-09-08T00:00:00.000Z',
  };
}

/** Drives a fixture unit through the real StateMachine/Router/HandoffIngestor pipeline
 *  (no store, no coordinator -- this test is about metrics derivation from the resulting
 *  event log, not about the coordinator itself) so the events fed into
 *  `deriveKnowledgeUnitMetrics` are exactly what the real pipeline would produce. */
function drive(
  eventLog: AppendOnlyEventLog,
  current: MultiAgentUnitState,
  handoff: AgentHandoff,
  occurredAt: string,
): MultiAgentUnitState {
  const route = routeAfterHandoff(handoff);
  const ingestor = new HandoffIngestor(eventLog);
  const ingested = ingestor.ingest(current, handoff, route.acceptedState, occurredAt);
  if (!route.activationState) return ingested.state;
  const activated = applyControllerActivation(ingested.state, route.activationState, occurredAt);
  eventLog.append(
    activated.unitId,
    'UNIT_STATE_TRANSITIONED',
    { actor: 'CONTROLLER', reason: 'activate routed work', from: ingested.state.state, to: activated.state, state: { ...activated } },
    occurredAt,
  );
  return activated;
}

function implementerHandoff(unitId: string, overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: `${unitId}-impl-1`,
    unitId,
    role: 'IMPLEMENTER',
    inputState: 'IMPLEMENTING',
    observedBaseSha: BASE,
    observedCandidateSha: CANDIDATE,
    unitDefinitionHash: UNIT_HASH,
    proofContractHash: PROOF_HASH,
    result: 'PASS',
    findings: [],
    outputArtifacts: [],
    startedAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:05:00.000Z',
    ...overrides,
  };
}

function verifierHandoff(unitId: string, overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: `${unitId}-verify-1`,
    unitId,
    role: 'VERIFIER',
    inputState: 'VERIFYING',
    observedBaseSha: BASE,
    observedCandidateSha: CANDIDATE,
    unitDefinitionHash: UNIT_HASH,
    proofContractHash: PROOF_HASH,
    result: 'PASS',
    verifierIndependent: true,
    findings: [],
    outputArtifacts: [],
    startedAt: '2026-09-08T00:10:00.000Z',
    finishedAt: '2026-09-08T00:15:00.000Z',
    ...overrides,
  };
}

describe('deriveKnowledgeUnitMetrics', () => {
  it('reconstructs implementation/verification timing, candidate SHA and hashes from events alone', () => {
    const unitId = 'KNOWLEDGE-METRICS-UNIT-1';
    const eventLog = new AppendOnlyEventLog();
    let state = seed(unitId);
    state = drive(eventLog, state, implementerHandoff(unitId), '2026-09-08T00:05:00.000Z');
    state = drive(eventLog, state, verifierHandoff(unitId), '2026-09-08T00:15:00.000Z');
    // routeAfterHandoff sends a VERIFIER PASS to READY_FOR_DEV_GOV and immediately auto-activates
    // it to PROVING_RED (same as the real DurableCoordinator) -- both transitions land in the log.
    expect(state.state).toBe('PROVING_RED');

    const metrics = deriveKnowledgeUnitMetrics(eventLog.all(), unitId);
    expect(metrics.implementationStartedAt).toBe('2026-09-08T00:05:00.000Z');
    expect(metrics.verificationStartedAt).toBe('2026-09-08T00:15:00.000Z');
    expect(metrics.candidateSha).toBe(CANDIDATE);
    expect(metrics.unitDefinitionHash).toBe(UNIT_HASH);
    expect(metrics.proofContractHash).toBe(PROOF_HASH);
    expect(metrics.retries).toBe(0);
    expect(metrics.firstPassVerification).toBe(true);
    expect(metrics.implementerAgentRunIds).toEqual([`${unitId}-impl-1`]);
    expect(metrics.verifierAgentRunIds).toEqual([`${unitId}-verify-1`]);
    expect(metrics.wallClockMs).toBeGreaterThan(0);
  });

  it('counts a verifier FAIL as a retry and turns off firstPassVerification', () => {
    const unitId = 'KNOWLEDGE-METRICS-UNIT-2';
    const eventLog = new AppendOnlyEventLog();
    let state = seed(unitId);
    state = drive(eventLog, state, implementerHandoff(unitId), '2026-09-08T00:05:00.000Z');
    state = drive(
      eventLog,
      state,
      verifierHandoff(unitId, {
        result: 'FAIL',
        verifierIndependent: undefined,
        findings: [{ id: 'F1', severity: 'BLOCKING', classification: 'SEMANTIC', message: 'gap' }],
      }),
      '2026-09-08T00:15:00.000Z',
    );
    // A VERIFIER FAIL is auto-routed straight back to IMPLEMENTING (mechanical/semantic reopen);
    // VERIFY_FAILED is still recorded as an intermediate UNIT_STATE_TRANSITIONED event, which is
    // exactly what `retries` below counts.
    expect(state.state).toBe('IMPLEMENTING');

    const metrics = deriveKnowledgeUnitMetrics(eventLog.all(), unitId);
    expect(metrics.retries).toBe(1);
    expect(metrics.firstPassVerification).toBe(false);
  });

  it('counts a BLOCKED_DESIGN landing as a human intervention point', () => {
    const unitId = 'KNOWLEDGE-METRICS-UNIT-3';
    const eventLog = new AppendOnlyEventLog();
    const state = seed(unitId);
    drive(
      eventLog,
      state,
      implementerHandoff(unitId, { result: 'BLOCKED_DESIGN', findings: [], outputArtifacts: [] }),
      '2026-09-08T00:05:00.000Z',
    );

    const metrics = deriveKnowledgeUnitMetrics(eventLog.all(), unitId);
    expect(metrics.humanInterventionCount).toBe(1);
  });

  it('keeps two independent Knowledge units in the same event log fully separate', () => {
    const unitA = 'KNOWLEDGE-METRICS-UNIT-A';
    const unitB = 'KNOWLEDGE-METRICS-UNIT-B';
    const eventLog = new AppendOnlyEventLog();
    drive(eventLog, seed(unitA), implementerHandoff(unitA), '2026-09-08T00:05:00.000Z');
    // BLOCKED_DEPENDENCY is a routable, no-activation outcome (unlike a plain IMPLEMENTER FAIL,
    // which has no automatic route and is a controller-only decision) -- a good second, distinct
    // shape to prove per-unit isolation with.
    drive(
      eventLog,
      seed(unitB),
      implementerHandoff(unitB, { result: 'BLOCKED_DEPENDENCY', findings: [] }),
      '2026-09-08T00:06:00.000Z',
    );

    const metricsA = deriveKnowledgeUnitMetrics(eventLog.all(), unitA);
    const metricsB = deriveKnowledgeUnitMetrics(eventLog.all(), unitB);
    expect(metricsA.implementerAgentRunIds).toEqual([`${unitA}-impl-1`]);
    expect(metricsB.implementerAgentRunIds).toEqual([`${unitB}-impl-1`]);
    expect(metricsA.terminalResult).toBeUndefined();
  });

  it('is deterministic: re-deriving from the same events twice yields identical output', () => {
    const unitId = 'KNOWLEDGE-METRICS-UNIT-4';
    const eventLog = new AppendOnlyEventLog();
    drive(eventLog, seed(unitId), implementerHandoff(unitId), '2026-09-08T00:05:00.000Z');
    const events = eventLog.all();
    expect(JSON.stringify(deriveKnowledgeUnitMetrics(events, unitId))).toBe(
      JSON.stringify(deriveKnowledgeUnitMetrics(events, unitId)),
    );
  });
});

describe('summarizeKnowledgeThroughput', () => {
  it('computes first-pass and retry rates from a set of per-unit snapshots', () => {
    const clean = deriveKnowledgeUnitMetrics(
      (() => {
        const log = new AppendOnlyEventLog();
        let s = seed('T1');
        s = drive(log, s, implementerHandoff('T1'), '2026-09-08T00:00:00.000Z');
        drive(log, s, verifierHandoff('T1'), '2026-09-08T00:05:00.000Z');
        return log.all();
      })(),
      'T1',
    );
    const retried = deriveKnowledgeUnitMetrics(
      (() => {
        const log = new AppendOnlyEventLog();
        let s = seed('T2');
        s = drive(log, s, implementerHandoff('T2'), '2026-09-08T00:00:00.000Z');
        drive(
          log,
          s,
          verifierHandoff('T2', { result: 'FAIL', verifierIndependent: undefined, findings: [] }),
          '2026-09-08T00:05:00.000Z',
        );
        return log.all();
      })(),
      'T2',
    );

    const summary = summarizeKnowledgeThroughput([clean, retried]);
    expect(summary.unitCount).toBe(2);
    expect(summary.verifiedUnitCount).toBe(1);
    expect(summary.firstPassVerificationRate).toBe(0.5);
    expect(summary.retryRate).toBe(0.5);
  });

  it('returns zeroed rates for an empty set rather than dividing by zero', () => {
    const summary = summarizeKnowledgeThroughput([]);
    expect(summary.unitCount).toBe(0);
    expect(summary.firstPassVerificationRate).toBe(0);
    expect(summary.retryRate).toBe(0);
    expect(summary.failedUnitRate).toBe(0);
    expect(summary.humanInterventionsPerVerifiedUnit).toBe(0);
    expect(summary.averageWallClockMs).toBeUndefined();
  });
});
