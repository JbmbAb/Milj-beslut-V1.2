import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DevGovReconciler,
  FileCorrelationStore,
  FileDurableControlPlaneStore,
  WorkflowDispatchCorrelator,
  verifyAuthoritativeProof,
  type DevGovAuthoritativeProof,
  type DevGovAuthoritativeProofPort,
  type DevGovProofLookup,
  type DevGovTelemetryStatusPort,
  type DevGovWorkflowAvailabilityPort,
  type MultiAgentUnitState,
  type ObservedWorkflowRun,
  type ReconciliationOutcome,
  type RemoteExecutionObservation,
  type TelemetryStatusObservation,
} from '../../../packages/mps-control-plane/src/multi-agent';

/**
 * CONTROL-PLANE AUTHORITY INVARIANT
 *
 *   OBSERVATION MUST NEVER CREATE OR SUBSTITUTE AUTHORITY.
 *
 * The regression these tests exist for: an earlier revision accepted the shared
 * commit-status context `DEV-GOV-V0 / trusted-execution` with `state: success`
 * as sufficient evidence of a passed gate, and emitted a GATE/PASS proposal
 * from it. A commit status is a repository-scoped mutable label that any actor
 * with write access can post on any SHA — it names no unit, no revision, no run
 * and no proof — so that path let a forged label advance GATING -> GATE_PASSED
 * -> PROMOTING.
 *
 * Every case below asserts the same two things: the outcome is not the
 * authority-bearing one, and canonical state did not move.
 */

const roots: string[] = [];
const candidateSha = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const refShaAtDispatch = '3'.repeat(40);
const unitDefinitionHash = 'a'.repeat(64);
const proofContractHash = 'b'.repeat(64);
const TRUSTED_WORKFLOW = 'owner/repo/.github/workflows/devgov-v0-gate.yml@refs/heads/main';
const CLOCK = '2026-09-05T01:00:00.000Z';
const DISPATCH_KEY = 'K1:9:DEV_GOV';
const BOUND_RUN_ID = '77';

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tmpFile(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return path.join(root, 'state.json');
}

function unit(overrides: Partial<MultiAgentUnitState> = {}): MultiAgentUnitState {
  return {
    unitId: 'K1',
    unitDefinitionHash,
    baseSha,
    candidateSha,
    branch: 'claude/k1',
    scope: ['packages/mps-data-governance/**'],
    proofContractHash,
    controllerContractVersion: 'multi-agent-control-plane-v1',
    state: 'GATING',
    revision: 9,
    updatedAt: CLOCK,
    ...overrides,
  };
}

function run(overrides: Partial<ObservedWorkflowRun> = {}): ObservedWorkflowRun {
  return {
    runId: BOUND_RUN_ID,
    workflow: 'devgov-v0-orchestrate.yml',
    headBranch: 'main',
    headSha: refShaAtDispatch,
    event: 'workflow_dispatch',
    createdAt: '2026-09-05T01:00:01.000Z',
    status: 'completed',
    conclusion: 'success',
    htmlUrl: 'https://example.invalid/run/77',
    ...overrides,
  };
}

function proof(overrides: Partial<DevGovAuthoritativeProof> = {}): DevGovAuthoritativeProof {
  return {
    proofId: 'devgov-proof-0001',
    unitId: 'K1',
    unitRevision: 9,
    candidateSha,
    unitDefinitionHash,
    proofContractHash,
    workflowIdentity: TRUSTED_WORKFLOW,
    workflowRunId: BOUND_RUN_ID,
    result: 'PASS',
    ...overrides,
  };
}

function boundRun(overrides: Partial<RemoteExecutionObservation> = {}): RemoteExecutionObservation {
  return {
    workflow: 'devgov-v0-orchestrate.yml',
    runId: BOUND_RUN_ID,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function expectation(overrides: Record<string, unknown> = {}) {
  return {
    unitId: 'K1',
    unitRevision: 9,
    candidateSha,
    unitDefinitionHash,
    proofContractHash,
    trustedWorkflowIdentity: TRUSTED_WORKFLOW,
    boundRun: boundRun(),
    ...overrides,
  } as Parameters<typeof verifyAuthoritativeProof>[1];
}

/** A status any actor with repo write access could have posted. */
function hostileStatus(overrides: Partial<TelemetryStatusObservation> = {}): DevGovTelemetryStatusPort {
  const observation: TelemetryStatusObservation = {
    context: 'DEV-GOV-V0 / trusted-execution',
    state: 'success',
    creatorLogin: 'github-actions[bot]',
    targetUrl: 'https://example.invalid/actions/runs/77',
    ...overrides,
  };
  return {
    async observeStatus() {
      return observation;
    },
  };
}

class Available implements DevGovWorkflowAvailabilityPort {
  async workflowExists() {
    return true;
  }
}

class ProofPort implements DevGovAuthoritativeProofPort {
  constructor(private readonly lookup: DevGovProofLookup) {}
  async fetchProof() {
    return this.lookup;
  }
}

async function correlatedTo(observed: ObservedWorkflowRun): Promise<WorkflowDispatchCorrelator> {
  const corr = new WorkflowDispatchCorrelator(
    new FileCorrelationStore(tmpFile('mimer-correlation-')),
    { getRefSha: async () => refShaAtDispatch, dispatchWorkflow: async () => {} },
    { listRuns: async () => [observed] },
    { now: () => new Date(CLOCK) },
  );
  await corr.dispatch({
    dispatchKey: DISPATCH_KEY,
    workflow: 'devgov-v0-orchestrate.yml',
    ref: 'main',
    inputs: {},
  });
  await corr.poll(DISPATCH_KEY);
  return corr;
}

/**
 * Drives one reconcile against a hostile-but-successful commit status, so every
 * case is evaluated in the presence of exactly the signal that used to be
 * sufficient on its own.
 */
async function attack(args: {
  readonly lookup: DevGovProofLookup;
  readonly unitOverrides?: Partial<MultiAgentUnitState>;
  readonly observedRun?: ObservedWorkflowRun;
  readonly telemetry?: DevGovTelemetryStatusPort;
  readonly expectedCandidateSha?: string;
  readonly dispatchKey?: string | null;
}): Promise<{ outcome: ReconciliationOutcome; store: FileDurableControlPlaneStore }> {
  const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
  store.initializeUnit(unit(args.unitOverrides));
  const corr = await correlatedTo(args.observedRun ?? run());
  const reconciler = new DevGovReconciler({
    store,
    availability: new Available(),
    correlator: corr,
    authoritativeProof: new ProofPort(args.lookup),
    trustedWorkflowIdentity: TRUSTED_WORKFLOW,
    telemetry: args.telemetry ?? hostileStatus(),
    now: () => new Date(CLOCK),
  });
  const outcome = await reconciler.reconcile({
    expectedUnitId: 'K1',
    expectedRevision: args.unitOverrides?.revision ?? 9,
    expectedCandidateSha: args.expectedCandidateSha,
    workflow: 'devgov-v0-orchestrate.yml',
    protectedRef: 'main',
    dispatchKey: args.dispatchKey === null ? undefined : (args.dispatchKey ?? DISPATCH_KEY),
  });
  return { outcome, store };
}

function expectNoAdvance(outcome: ReconciliationOutcome, store: FileDurableControlPlaneStore): void {
  expect(outcome.kind).not.toBe('AUTHORITATIVE_GATE_PROVEN');
  expect(outcome).not.toHaveProperty('proposedHandoff');
  const unitState = store.read().units.K1;
  expect(unitState.state).toBe('GATING');
  expect(unitState.revision).toBe(9);
}

describe('DEV-GOV authority binding — a commit status can never authorize an advance', () => {
  it('A1: same context + success written by an unrelated actor does not advance', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'NOT_FOUND' },
      telemetry: hostileStatus({ creatorLogin: 'mallory' }),
    });
    expect(outcome.kind).toBe('NO_SIGNAL');
    expectNoAdvance(outcome, store);
  });

  it('A2: same context + success pointing at an unrelated target_url does not advance', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'NOT_FOUND' },
      telemetry: hostileStatus({ targetUrl: 'https://attacker.invalid/looks-official' }),
    });
    expect(outcome.kind).toBe('NO_SIGNAL');
    expectNoAdvance(outcome, store);
  });

  it('A3: a proof from a workflow identity other than the trusted DEV-GOV workflow is rejected', async () => {
    const { outcome, store } = await attack({
      lookup: {
        status: 'RESOLVED',
        proof: proof({ workflowIdentity: 'owner/repo/.github/workflows/attacker.yml@refs/heads/main' }),
      },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_WORKFLOW_IDENTITY_UNTRUSTED' });
    expectNoAdvance(outcome, store);
  });

  it('A3b: the trusted workflow on a different ref is still not the trusted identity', async () => {
    const { outcome, store } = await attack({
      lookup: {
        status: 'RESOLVED',
        proof: proof({
          workflowIdentity: 'owner/repo/.github/workflows/devgov-v0-gate.yml@refs/heads/attacker',
        }),
      },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_WORKFLOW_IDENTITY_UNTRUSTED' });
    expectNoAdvance(outcome, store);
  });

  it('A4: the correct candidate SHA with no authoritative proof does not advance', async () => {
    const { outcome, store } = await attack({ lookup: { status: 'NOT_FOUND' } });
    expect(outcome.kind).toBe('NO_SIGNAL');
    expectNoAdvance(outcome, store);
  });

  it('A5: a successful OLD run for the same candidate is not the run bound to this dispatch', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ workflowRunId: '12' }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_RUN_MISMATCH' });
    expectNoAdvance(outcome, store);
  });

  it('A6: a successful run proving a different unit revision is rejected', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ unitRevision: 8 }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_REVISION_MISMATCH' });
    expectNoAdvance(outcome, store);
  });

  it('A7: a proof for a superseded candidate SHA is rejected', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ candidateSha: '9'.repeat(40) }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_CANDIDATE_MISMATCH' });
    expectNoAdvance(outcome, store);
  });

  it('A7b: a caller bound to a superseded candidate is refused before any proof is consulted', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof() },
      expectedCandidateSha: '9'.repeat(40),
    });
    expect(outcome).toMatchObject({ kind: 'STALE_SUPERSEDED' });
    expectNoAdvance(outcome, store);
  });

  it('A8: ambiguous proof correlation fails closed instead of choosing one', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'AMBIGUOUS', proofIds: ['devgov-proof-0001', 'devgov-proof-0002'] },
    });
    expect(outcome).toMatchObject({
      kind: 'AMBIGUOUS_PROOF',
      proofIds: ['devgov-proof-0001', 'devgov-proof-0002'],
    });
    expectNoAdvance(outcome, store);
  });

  it('A8b: ambiguous run correlation leaves no run bound, so no proof is attributable', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const corr = new WorkflowDispatchCorrelator(
      new FileCorrelationStore(tmpFile('mimer-correlation-')),
      { getRefSha: async () => refShaAtDispatch, dispatchWorkflow: async () => {} },
      { listRuns: async () => [run({ runId: '1' }), run({ runId: '2' })] },
      { now: () => new Date(CLOCK) },
    );
    await corr.dispatch({
      dispatchKey: DISPATCH_KEY,
      workflow: 'devgov-v0-orchestrate.yml',
      ref: 'main',
      inputs: {},
    });
    await corr.poll(DISPATCH_KEY);
    const reconciler = new DevGovReconciler({
      store,
      availability: new Available(),
      correlator: corr,
      authoritativeProof: new ProofPort({ status: 'RESOLVED', proof: proof() }),
      trustedWorkflowIdentity: TRUSTED_WORKFLOW,
      telemetry: hostileStatus(),
      now: () => new Date(CLOCK),
    });
    const outcome = await reconciler.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
      dispatchKey: DISPATCH_KEY,
    });
    expect(outcome.kind).toBe('PROOF_RUN_NOT_BOUND');
    expectNoAdvance(outcome, store);
  });

  it('A9: a successful status while the authoritative proof surface is unavailable becomes BLOCKED_DEPENDENCY, never a pass', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'UNAVAILABLE', reason: 'DEV-GOV proof artifact is not published on this base yet' },
    });
    expect(outcome).toMatchObject({ kind: 'BLOCKED_DEPENDENCY_APPLIED' });
    expect(outcome.kind).not.toBe('AUTHORITATIVE_GATE_PROVEN');
    expect(store.read().units.K1.state).toBe('BLOCKED_DEPENDENCY');
  });

  it('A10: a proof claiming PASS for a run GitHub reports as failed is vetoed by remote truth', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof() },
      observedRun: run({ conclusion: 'failure' }),
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_RUN_NOT_SUCCESSFUL' });
    expectNoAdvance(outcome, store);
  });

  it('A11: a proof whose authoritative result is not PASS never becomes a pass', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ result: 'FAIL' }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_RESULT_NOT_SUCCESSFUL' });
    expectNoAdvance(outcome, store);
  });

  it('A12: a proof produced under a different unit definition is rejected', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ unitDefinitionHash: 'c'.repeat(64) }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_UNIT_DEFINITION_MISMATCH' });
    expectNoAdvance(outcome, store);
  });

  it('A13: a proof for another unit is rejected', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ unitId: 'K2' }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_UNIT_MISMATCH' });
    expectNoAdvance(outcome, store);
  });

  it('A14: a proof with no canonical proof reference is rejected', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ proofId: '' }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_REFERENCE_MISSING' });
    expectNoAdvance(outcome, store);
  });

  it('no telemetry branch can reach the authority-bearing outcome', async () => {
    const nonAuthoritative: readonly DevGovProofLookup[] = [
      { status: 'NOT_FOUND' },
      { status: 'AMBIGUOUS', proofIds: ['p1', 'p2'] },
      { status: 'RESOLVED', proof: proof({ result: 'FAIL' }) },
      { status: 'RESOLVED', proof: proof({ workflowRunId: 'other' }) },
      { status: 'RESOLVED', proof: proof({ unitRevision: 1 }) },
    ];
    for (const lookup of nonAuthoritative) {
      const { outcome, store } = await attack({ lookup, telemetry: hostileStatus() });
      expectNoAdvance(outcome, store);
    }
  });

  it('the authoritative outcome does not depend on telemetry existing at all', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const corr = await correlatedTo(run());
    const reconciler = new DevGovReconciler({
      store,
      availability: new Available(),
      correlator: corr,
      authoritativeProof: new ProofPort({ status: 'RESOLVED', proof: proof() }),
      trustedWorkflowIdentity: TRUSTED_WORKFLOW,
      now: () => new Date(CLOCK),
    });
    const outcome = await reconciler.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
      dispatchKey: DISPATCH_KEY,
    });
    expect(outcome.kind).toBe('AUTHORITATIVE_GATE_PROVEN');
    expect(store.read().units.K1.state).toBe('GATING');
  });
});

describe('verifyAuthoritativeProof — every binding dimension is required', () => {
  it('accepts only a proof matching every dimension', () => {
    expect(verifyAuthoritativeProof(proof(), expectation())).toBeNull();
  });

  it.each([
    ['PROOF_REFERENCE_MISSING', proof({ proofId: '' })],
    ['PROOF_UNIT_MISMATCH', proof({ unitId: 'K2' })],
    ['PROOF_REVISION_MISMATCH', proof({ unitRevision: 10 })],
    ['PROOF_CANDIDATE_MISMATCH', proof({ candidateSha: '9'.repeat(40) })],
    ['PROOF_UNIT_DEFINITION_MISMATCH', proof({ unitDefinitionHash: 'c'.repeat(64) })],
    ['PROOF_CONTRACT_HASH_MISSING', proof({ proofContractHash: '' })],
    ['PROOF_CONTRACT_MISMATCH', proof({ proofContractHash: 'd'.repeat(64) })],
    ['PROOF_WORKFLOW_IDENTITY_UNTRUSTED', proof({ workflowIdentity: 'other/repo/x.yml@refs/heads/main' })],
    ['PROOF_RUN_MISMATCH', proof({ workflowRunId: '999' })],
    ['PROOF_RESULT_NOT_SUCCESSFUL', proof({ result: 'DENIED_GOVERNANCE' })],
  ])('rejects with %s', (reason, candidate) => {
    expect(verifyAuthoritativeProof(candidate, expectation())).toMatchObject({ reason });
  });

  it('rejects when the bound run itself did not complete successfully', () => {
    expect(
      verifyAuthoritativeProof(proof(), expectation({ boundRun: boundRun({ conclusion: 'failure' }) })),
    ).toMatchObject({ reason: 'PROOF_RUN_NOT_SUCCESSFUL' });
    expect(
      verifyAuthoritativeProof(proof(), expectation({ boundRun: boundRun({ status: 'in_progress' }) })),
    ).toMatchObject({ reason: 'PROOF_RUN_NOT_SUCCESSFUL' });
  });
});

/**
 * proofContractHash is a MANDATORY authority dimension on both sides of the
 * comparison. It is required by type on DevGovAuthoritativeProof and on
 * ProofExpectation, and — because proof data crosses an untyped boundary and
 * this repository compiles without `strict` — it is also guarded at runtime on
 * both sides. The equality check is unconditional: there is no path on which
 * it is skipped.
 */
describe('verifyAuthoritativeProof — proofContractHash is mandatory and unconditionally compared', () => {
  /** Simulates untyped external data that omitted the field entirely. */
  const withoutContractHash = (): DevGovAuthoritativeProof => {
    const { proofContractHash: _omitted, ...rest } = proof();
    return rest as unknown as DevGovAuthoritativeProof;
  };

  it('exact correct proofContractHash is eligible', () => {
    expect(
      verifyAuthoritativeProof(proof({ proofContractHash }), expectation({ proofContractHash })),
    ).toBeNull();
  });

  it('wrong proofContractHash is denied', () => {
    expect(
      verifyAuthoritativeProof(proof({ proofContractHash: 'd'.repeat(64) }), expectation()),
    ).toMatchObject({ reason: 'PROOF_CONTRACT_MISMATCH' });
  });

  it('a proof with the field absent (untyped external data) is denied, not treated as a wildcard', () => {
    expect(verifyAuthoritativeProof(withoutContractHash(), expectation())).toMatchObject({
      reason: 'PROOF_CONTRACT_HASH_MISSING',
    });
  });

  it('a proof with an empty proofContractHash is denied', () => {
    expect(verifyAuthoritativeProof(proof({ proofContractHash: '' }), expectation())).toMatchObject({
      reason: 'PROOF_CONTRACT_HASH_MISSING',
    });
  });

  it('an expectation with no proofContractHash cannot verify anything — runtime guard behind the required type', () => {
    const { proofContractHash: _omitted, ...rest } = expectation();
    const missing = rest as unknown as Parameters<typeof verifyAuthoritativeProof>[1];
    expect(verifyAuthoritativeProof(proof(), missing)).toMatchObject({
      reason: 'PROOF_CONTRACT_HASH_MISSING',
    });
    expect(verifyAuthoritativeProof(proof(), expectation({ proofContractHash: '' }))).toMatchObject({
      reason: 'PROOF_CONTRACT_HASH_MISSING',
    });
  });

  it('a missing proofContractHash on the proof cannot be compensated by a matching-looking absent expectation', () => {
    const { proofContractHash: _omitted, ...rest } = expectation();
    const missing = rest as unknown as Parameters<typeof verifyAuthoritativeProof>[1];
    // Both sides absent must still be a denial — undefined === undefined is not a binding.
    expect(verifyAuthoritativeProof(withoutContractHash(), missing)).toMatchObject({
      reason: 'PROOF_CONTRACT_HASH_MISSING',
    });
  });

  it('with the contract hash correct, every other exact tuple dimension is still required', () => {
    const mutations: ReadonlyArray<readonly [string, Partial<DevGovAuthoritativeProof>]> = [
      ['PROOF_REFERENCE_MISSING', { proofId: '' }],
      ['PROOF_UNIT_MISMATCH', { unitId: 'K2' }],
      ['PROOF_REVISION_MISMATCH', { unitRevision: 8 }],
      ['PROOF_CANDIDATE_MISMATCH', { candidateSha: '9'.repeat(40) }],
      ['PROOF_UNIT_DEFINITION_MISMATCH', { unitDefinitionHash: 'c'.repeat(64) }],
      ['PROOF_WORKFLOW_IDENTITY_UNTRUSTED', { workflowIdentity: 'other/repo/x.yml@refs/heads/main' }],
      ['PROOF_RUN_MISMATCH', { workflowRunId: '999' }],
      ['PROOF_RESULT_NOT_SUCCESSFUL', { result: 'FAIL' }],
    ];
    for (const [reason, mutation] of mutations) {
      expect(
        verifyAuthoritativeProof(proof({ ...mutation, proofContractHash }), expectation()),
      ).toMatchObject({
        reason,
      });
    }
  });
});

describe('DEV-GOV reconciliation — proofContractHash is enforced at the controller boundary', () => {
  it('a hostile successful status cannot compensate for a proof that lacks a proofContractHash', async () => {
    const { proofContractHash: _omitted, ...rest } = proof();
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: rest as unknown as DevGovAuthoritativeProof },
      telemetry: hostileStatus({ creatorLogin: 'github-actions[bot]' }),
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_CONTRACT_HASH_MISSING' });
    expectNoAdvance(outcome, store);
  });

  it('a proof with the wrong proofContractHash is rejected at the controller boundary', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ proofContractHash: 'd'.repeat(64) }) },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_CONTRACT_MISMATCH' });
    expectNoAdvance(outcome, store);
  });

  it('a canonical unit with no proofContractHash can never bind a proof, even a perfect-looking one', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof() },
      unitOverrides: { proofContractHash: undefined },
    });
    expect(outcome).toMatchObject({ kind: 'PROOF_REJECTED', reason: 'PROOF_CONTRACT_HASH_MISSING' });
    expectNoAdvance(outcome, store);
    // The canonical record really has no contract hash — the guard fired on the controller's own state.
    expect(store.read().units.K1.proofContractHash).toBeUndefined();
  });

  it('the exact correct proofContractHash remains eligible end-to-end', async () => {
    const { outcome, store } = await attack({
      lookup: { status: 'RESOLVED', proof: proof({ proofContractHash }) },
    });
    expect(outcome).toMatchObject({ kind: 'AUTHORITATIVE_GATE_PROVEN', proofId: 'devgov-proof-0001' });
    expect(store.read().units.K1.state).toBe('GATING');
  });
});
