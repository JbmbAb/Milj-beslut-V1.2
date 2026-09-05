import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DevGovReconciler,
  FileCorrelationStore,
  FileDurableControlPlaneStore,
  WorkflowDispatchCorrelator,
  type DevGovCommitStatusObserverPort,
  type DevGovWorkflowAvailabilityPort,
  type GitHubActionsRunObserverPort,
  type GitHubWorkflowDispatchPort,
  type MultiAgentUnitState,
  type ObservedWorkflowRun,
} from '../../../packages/mps-control-plane/src/multi-agent';

const roots: string[] = [];
const candidateSha = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const unitDefinitionHash = 'a'.repeat(64);
const proofContractHash = 'b'.repeat(64);

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
    updatedAt: '2026-09-05T01:00:00.000Z',
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
    return '3'.repeat(40);
  }
  async dispatchWorkflow() {}
}

class RunObserver implements GitHubActionsRunObserverPort {
  constructor(private runs: ObservedWorkflowRun[] = []) {}
  async listRuns() {
    return this.runs;
  }
}

class CommitStatus implements DevGovCommitStatusObserverPort {
  constructor(private readonly value: 'success' | 'failure' | 'error' | 'pending' | undefined) {}
  async getStatus() {
    return this.value;
  }
}

function correlator(observer: GitHubActionsRunObserverPort = new RunObserver()): WorkflowDispatchCorrelator {
  return new WorkflowDispatchCorrelator(
    new FileCorrelationStore(tmpFile('mimer-correlation-')),
    new DispatchPort(),
    observer,
    { now: () => new Date('2026-09-05T01:00:00.000Z') },
  );
}

function reconciler(
  store: FileDurableControlPlaneStore,
  availability: DevGovWorkflowAvailabilityPort,
  commitStatus: DevGovCommitStatusObserverPort,
  corr: WorkflowDispatchCorrelator = correlator(),
): DevGovReconciler {
  return new DevGovReconciler(
    store,
    availability,
    corr,
    commitStatus,
    () => new Date('2026-09-05T01:00:00.000Z'),
  );
}

describe('DEV-GOV reconciliation (Parts C, D, F)', () => {
  it('classifies BLOCKED_DEPENDENCY when the DEV-GOV orchestration workflow does not exist, without dispatching or faking completion', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler(store, new Availability(false), new CommitStatus(undefined));

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

  it('never manufactures a gate/promotion result: only relays an already-authoritative DEV-GOV-V0 commit status', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler(store, new Availability(true), new CommitStatus('success'));

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      expectedCandidateSha: candidateSha,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });

    expect(outcome).toMatchObject({
      kind: 'EXTERNAL_GATE_OBSERVED',
      candidateSha,
      proposedHandoff: { role: 'GATE', result: 'PASS', observedCandidateSha: candidateSha },
    });
    // The reconciler itself must not have advanced canonical state — it only proposes.
    expect(store.read().units.K1.state).toBe('GATING');
    expect(store.read().units.K1.revision).toBe(9);
  });

  it('reports NO_SIGNAL rather than guessing when the dependency exists but has not reported success yet', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler(store, new Availability(true), new CommitStatus('pending'));
    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });
    expect(outcome).toEqual({ kind: 'NO_SIGNAL' });
    expect(store.read().units.K1.state).toBe('GATING');
  });

  it('refuses to advance when the candidate was superseded since the reconciliation was scheduled (Part D binding)', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const r = reconciler(store, new Availability(true), new CommitStatus('success'));

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
    const r = reconciler(store, new Availability(true), new CommitStatus('success'));
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
    const observer = new RunObserver([
      {
        runId: '1',
        workflow: 'devgov-v0-orchestrate.yml',
        headBranch: 'main',
        headSha: '3'.repeat(40),
        event: 'workflow_dispatch',
        createdAt: '2026-09-05T01:00:01.000Z',
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'x',
      },
      {
        runId: '2',
        workflow: 'devgov-v0-orchestrate.yml',
        headBranch: 'main',
        headSha: '3'.repeat(40),
        event: 'workflow_dispatch',
        createdAt: '2026-09-05T01:00:01.000Z',
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'x',
      },
    ]);
    const corr = correlator(observer);
    await corr.dispatch({
      dispatchKey: 'K1:9:DEV_GOV',
      workflow: 'devgov-v0-orchestrate.yml',
      ref: 'main',
      inputs: {},
    });
    const r = reconciler(store, new Availability(true), new CommitStatus(undefined), corr);

    const outcome = await r.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
      dispatchKey: 'K1:9:DEV_GOV',
    });
    expect(outcome).toMatchObject({ kind: 'AMBIGUOUS_CORRELATION' });
    expect(store.read().units.K1.state).toBe('PROVING_RED');
  });
});
