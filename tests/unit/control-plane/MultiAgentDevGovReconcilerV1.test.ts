import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DevGovReconciler,
  FileCorrelationStore,
  FileDurableControlPlaneStore,
  WorkflowDispatchCorrelator,
  type DevGovAuthoritativeProof,
  type DevGovAuthoritativeProofPort,
  type DevGovProofLookup,
  type DevGovTelemetryStatusPort,
  type DevGovWorkflowAvailabilityPort,
  type GitHubActionsRunObserverPort,
  type GitHubWorkflowDispatchPort,
  type MultiAgentUnitState,
  type ObservedWorkflowRun,
  type TelemetryStatusObservation,
} from '../../../packages/mps-control-plane/src/multi-agent';

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

class Availability implements DevGovWorkflowAvailabilityPort {
  constructor(private readonly available: boolean) {}
  async workflowExists() {
    return this.available;
  }
}

class DispatchPort implements GitHubWorkflowDispatchPort {
  async getRefSha() {
    return refShaAtDispatch;
  }
  async dispatchWorkflow() {}
}

class RunObserver implements GitHubActionsRunObserverPort {
  constructor(private readonly runs: ObservedWorkflowRun[] = []) {}
  async listRuns() {
    return this.runs;
  }
}

class Telemetry implements DevGovTelemetryStatusPort {
  constructor(private readonly observation: TelemetryStatusObservation | undefined) {}
  async observeStatus() {
    return this.observation;
  }
}

class ProofPort implements DevGovAuthoritativeProofPort {
  readonly queries: unknown[] = [];
  constructor(private readonly lookup: DevGovProofLookup) {}
  async fetchProof(query: unknown) {
    this.queries.push(query);
    return this.lookup;
  }
}

function successTelemetry(overrides: Partial<TelemetryStatusObservation> = {}): Telemetry {
  return new Telemetry({
    context: 'DEV-GOV-V0 / trusted-execution',
    state: 'success',
    creatorLogin: 'github-actions[bot]',
    targetUrl: 'https://example.invalid/actions/runs/77',
    ...overrides,
  });
}

function correlator(observer: GitHubActionsRunObserverPort = new RunObserver()): WorkflowDispatchCorrelator {
  return new WorkflowDispatchCorrelator(
    new FileCorrelationStore(tmpFile('mimer-correlation-')),
    new DispatchPort(),
    observer,
    { now: () => new Date(CLOCK) },
  );
}

/** A correlator whose dispatchKey is already durably CORRELATED to `observed`. */
async function correlatedTo(observed: ObservedWorkflowRun): Promise<WorkflowDispatchCorrelator> {
  const corr = correlator(new RunObserver([observed]));
  await corr.dispatch({
    dispatchKey: DISPATCH_KEY,
    workflow: 'devgov-v0-orchestrate.yml',
    ref: 'main',
    inputs: {},
  });
  await corr.poll(DISPATCH_KEY);
  return corr;
}

function reconciler(args: {
  store: FileDurableControlPlaneStore;
  availability: DevGovWorkflowAvailabilityPort;
  authoritativeProof: DevGovAuthoritativeProofPort;
  telemetry?: DevGovTelemetryStatusPort;
  corr?: WorkflowDispatchCorrelator;
}): DevGovReconciler {
  return new DevGovReconciler({
    store: args.store,
    availability: args.availability,
    correlator: args.corr ?? correlator(),
    authoritativeProof: args.authoritativeProof,
    trustedWorkflowIdentity: TRUSTED_WORKFLOW,
    telemetry: args.telemetry,
    now: () => new Date(CLOCK),
  });
}

const NEVER_QUERIED: DevGovAuthoritativeProofPort = {
  async fetchProof() {
    throw new Error('authoritative proof must not be consulted on this path');
  },
};

describe('DEV-GOV reconciliation (Parts C, D, F)', () => {
  it('classifies BLOCKED_DEPENDENCY when the DEV-GOV orchestration workflow does not exist, without dispatching or faking completion', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler({
      store,
      availability: new Availability(false),
      authoritativeProof: NEVER_QUERIED,
    });

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });

    expect(outcome).toMatchObject({ kind: 'BLOCKED_DEPENDENCY_APPLIED' });
    expect(store.read().units.K1.state).toBe('BLOCKED_DEPENDENCY');
    expect(store.read().units.K1.revision).toBe(10);

    const again = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 10,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });
    expect(again).toEqual({ kind: 'ALREADY_BLOCKED_DEPENDENCY' });
  });

  it('a successful DEV-GOV commit status is telemetry only and cannot advance anything on its own', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler({
      store,
      availability: new Availability(true),
      telemetry: successTelemetry(),
      // No dispatch key is supplied, so no run is bound and no proof is attributable.
      authoritativeProof: NEVER_QUERIED,
    });

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      expectedCandidateSha: candidateSha,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });

    expect(outcome.kind).toBe('PROOF_RUN_NOT_BOUND');
    expect(outcome).not.toHaveProperty('proposedHandoff');
    expect(store.read().units.K1.state).toBe('GATING');
    expect(store.read().units.K1.revision).toBe(9);
  });

  it('reports NO_SIGNAL rather than guessing when the dependency exists but no proof has been published yet', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const corr = await correlatedTo(run());
    const r = reconciler({
      store,
      availability: new Availability(true),
      telemetry: new Telemetry({ context: 'DEV-GOV-V0 / trusted-execution', state: 'pending' }),
      authoritativeProof: new ProofPort({ status: 'NOT_FOUND' }),
      corr,
    });
    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
      dispatchKey: DISPATCH_KEY,
    });
    expect(outcome.kind).toBe('NO_SIGNAL');
    expect(store.read().units.K1.state).toBe('GATING');
  });

  it('refuses to advance when the candidate was superseded since the reconciliation was scheduled (Part D binding)', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler({
      store,
      availability: new Availability(true),
      telemetry: successTelemetry(),
      authoritativeProof: NEVER_QUERIED,
    });

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      expectedCandidateSha: '9'.repeat(40),
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });
    expect(outcome).toMatchObject({ kind: 'STALE_SUPERSEDED' });
    expect(store.read().units.K1.state).toBe('GATING');
  });

  it('refuses to advance when the canonical unit has already moved past the expected revision (Part D binding)', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler({
      store,
      availability: new Availability(true),
      telemetry: successTelemetry(),
      authoritativeProof: NEVER_QUERIED,
    });
    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 4,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });
    expect(outcome).toMatchObject({ kind: 'STALE_SUPERSEDED' });
  });

  it('reports ambiguous GitHub run correlation for PROVING_RED units without applying any state change', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit({ state: 'PROVING_RED' }));
    const observer = new RunObserver([run({ runId: '1' }), run({ runId: '2' })]);
    const corr = correlator(observer);
    await corr.dispatch({
      dispatchKey: DISPATCH_KEY,
      workflow: 'devgov-v0-orchestrate.yml',
      ref: 'main',
      inputs: {},
    });
    const r = reconciler({
      store,
      availability: new Availability(true),
      authoritativeProof: NEVER_QUERIED,
      corr,
    });

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
      dispatchKey: DISPATCH_KEY,
    });
    expect(outcome).toMatchObject({ kind: 'AMBIGUOUS_CORRELATION' });
    expect(store.read().units.K1.state).toBe('PROVING_RED');
  });

  it('POSITIVE: an authoritative proof binding every dimension produces the gate-complete proposal, and only proposes', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const corr = await correlatedTo(run());
    const port = new ProofPort({ status: 'RESOLVED', proof: proof() });
    const r = reconciler({
      store,
      availability: new Availability(true),
      telemetry: successTelemetry(),
      authoritativeProof: port,
      corr,
    });

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      expectedCandidateSha: candidateSha,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
      dispatchKey: DISPATCH_KEY,
    });

    expect(outcome).toMatchObject({
      kind: 'AUTHORITATIVE_GATE_PROVEN',
      candidateSha,
      proofId: 'devgov-proof-0001',
      workflowRunId: BOUND_RUN_ID,
      proposedHandoff: {
        role: 'GATE',
        result: 'PASS',
        observedCandidateSha: candidateSha,
        unitRevision: 9,
        proofId: 'devgov-proof-0001',
        workflowRunId: BOUND_RUN_ID,
      },
    });
    // The proof is looked up for the exact bound run, never for "any run on this SHA".
    expect(port.queries[0]).toMatchObject({
      unitId: 'K1',
      unitRevision: 9,
      candidateSha,
      workflowRunId: BOUND_RUN_ID,
    });
    // Proposal only: the reconciler itself never advances canonical state.
    expect(store.read().units.K1.state).toBe('GATING');
    expect(store.read().units.K1.revision).toBe(9);
  });
});
