import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentMailboxConflictError,
  AgentProcessCancelledError,
  DevGovReconciler,
  DuplicateHandoffConflictError,
  DurableMultiAgentCoordinator,
  FileAgentMailbox,
  FileCorrelationStore,
  FileDurableControlPlaneStore,
  ProcessAgentWorker,
  WorkflowDispatchCorrelator,
  type AgentDispatchPort,
  type AgentHandoff,
  type AgentHandoffSink,
  type AgentProcessExecutor,
  type AgentWorkItem,
  type DevGovCommitStatusObserverPort,
  type DevGovDispatchPort,
  type DevGovWorkflowAvailabilityPort,
  type DevGovWorkItem,
  type GitHubActionsRunObserverPort,
  type GitHubWorkflowDispatchPort,
  type MultiAgentUnitState,
  type ObservedWorkflowRun,
} from '../../../packages/mps-control-plane/src/multi-agent';

const roots: string[] = [];
const baseSha = '1'.repeat(40);
const candidateSha = '2'.repeat(40);
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
    branch: 'feature/k1',
    scope: ['packages/**'],
    proofContractHash,
    controllerContractVersion: 'multi-agent-control-plane-v1',
    state: 'VERIFYING',
    revision: 3,
    updatedAt: '2026-09-05T01:00:00.000Z',
    ...overrides,
  };
}

function verifierPassHandoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: 'codex-1',
    unitId: 'K1',
    role: 'VERIFIER',
    inputState: 'VERIFYING',
    observedBaseSha: baseSha,
    observedCandidateSha: candidateSha,
    unitDefinitionHash,
    proofContractHash,
    result: 'PASS',
    verifierIndependent: true,
    findings: [],
    outputArtifacts: [],
    startedAt: '2026-09-05T01:10:00.000Z',
    finishedAt: '2026-09-05T01:20:00.000Z',
    ...overrides,
  };
}

/** IMPLEMENTER/PASS routes to the agent-dispatch port (VERIFIER work), unlike verifierPassHandoff which routes to DEV-GOV. */
function implementerUnit(overrides: Partial<MultiAgentUnitState> = {}): MultiAgentUnitState {
  return {
    unitId: 'K1',
    unitDefinitionHash,
    baseSha,
    branch: 'feature/k1',
    scope: ['packages/**'],
    controllerContractVersion: 'multi-agent-control-plane-v1',
    state: 'IMPLEMENTING',
    revision: 1,
    updatedAt: '2026-09-05T01:00:00.000Z',
    ...overrides,
  };
}

function implementerPassHandoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    agentRunId: 'codex-impl-1',
    unitId: 'K1',
    role: 'IMPLEMENTER',
    inputState: 'IMPLEMENTING',
    observedBaseSha: baseSha,
    observedCandidateSha: candidateSha,
    unitDefinitionHash,
    result: 'PASS',
    findings: [],
    outputArtifacts: [],
    startedAt: '2026-09-05T01:10:00.000Z',
    finishedAt: '2026-09-05T01:20:00.000Z',
    ...overrides,
  };
}

class FlakyAgentDispatch implements AgentDispatchPort {
  calls: AgentWorkItem[] = [];
  constructor(private failFirst: number) {}
  async dispatch(item: AgentWorkItem): Promise<string> {
    this.calls.push(item);
    if (this.failFirst > 0) {
      this.failFirst -= 1;
      throw new Error('simulated crash: dispatch call did not complete');
    }
    return `dispatched:${item.dispatchKey}`;
  }
}

class NoOpDevGov implements DevGovDispatchPort {
  async dispatch(item: DevGovWorkItem): Promise<string> {
    return `devgov:${item.dispatchKey}`;
  }
}

describe('Crash / retry / idempotency guarantees (Part E)', () => {
  it('1. crash after dispatch but before local acknowledgement: the committed transition and PENDING outbox entry survive, and a retry dispatches exactly once', async () => {
    const storeFile = tmpFile('mimer-store-');
    const store = new FileDurableControlPlaneStore(storeFile);
    store.initializeUnit(implementerUnit());

    const flaky = new FlakyAgentDispatch(1);
    const crashing = new DurableMultiAgentCoordinator({
      store,
      agentDispatch: flaky,
      devGovDispatch: new NoOpDevGov(),
    });
    await expect(crashing.acceptHandoff(implementerPassHandoff())).rejects.toThrow(/simulated crash/);

    // The state transition and PENDING outbox entry were durably committed
    // before the dispatch attempt — nothing was lost.
    const afterCrash = store.read();
    expect(afterCrash.units.K1.state).toBe('VERIFYING');
    expect(Object.values(afterCrash.outbox)).toHaveLength(1);
    expect(Object.values(afterCrash.outbox)[0].status).toBe('PENDING');

    const recovered = new DurableMultiAgentCoordinator({
      store: new FileDurableControlPlaneStore(storeFile),
      agentDispatch: flaky,
      devGovDispatch: new NoOpDevGov(),
    });
    const dispatched = await recovered.flushPending();
    expect(dispatched).toHaveLength(1);
    expect(flaky.calls).toHaveLength(2); // one failed attempt + one successful retry
    expect(store.read().outbox[Object.keys(store.read().outbox)[0]].status).toBe('DISPATCHED');
  });

  it('2. duplicate dispatch reconciliation: re-ingesting the same accepted handoff never dispatches a second time', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(implementerUnit());
    const dispatch = new FlakyAgentDispatch(0);
    const coordinator = new DurableMultiAgentCoordinator({
      store,
      agentDispatch: dispatch,
      devGovDispatch: new NoOpDevGov(),
    });

    const first = await coordinator.acceptHandoff(implementerPassHandoff());
    const second = await coordinator.acceptHandoff(implementerPassHandoff());
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(dispatch.calls).toHaveLength(1);
  });

  it('3. ambiguous GitHub run correlation is rejected rather than guessed', async () => {
    class Dispatch implements GitHubWorkflowDispatchPort {
      async getRefSha() {
        return '3'.repeat(40);
      }
      async dispatchWorkflow() {}
    }
    function observedRun(runId: string): ObservedWorkflowRun {
      return {
        runId,
        workflow: 'wf.yml',
        headBranch: 'main',
        headSha: '3'.repeat(40),
        event: 'workflow_dispatch',
        createdAt: '2026-09-05T01:00:01.000Z',
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'x',
      };
    }
    class Observer implements GitHubActionsRunObserverPort {
      async listRuns() {
        return [observedRun('1'), observedRun('2')];
      }
    }
    const correlator = new WorkflowDispatchCorrelator(
      new FileCorrelationStore(tmpFile('mimer-correlation-')),
      new Dispatch(),
      new Observer(),
      { now: () => new Date('2026-09-05T01:00:00.000Z') },
    );
    await correlator.dispatch({ dispatchKey: 'K1:3:DEV_GOV', workflow: 'wf.yml', ref: 'main', inputs: {} });
    const resolved = await correlator.poll('K1:3:DEV_GOV');
    expect(resolved.status).toBe('AMBIGUOUS_CORRELATION');
  });

  it('4. restart with pending outbox: a brand-new process instance over the same durable file flushes exactly the pending items', async () => {
    const storeFile = tmpFile('mimer-store-');
    const firstProcess = new FileDurableControlPlaneStore(storeFile);
    firstProcess.initializeUnit(implementerUnit());
    const dispatch = new FlakyAgentDispatch(1);
    const crashing = new DurableMultiAgentCoordinator({
      store: firstProcess,
      agentDispatch: dispatch,
      devGovDispatch: new NoOpDevGov(),
    });
    await expect(crashing.acceptHandoff(implementerPassHandoff())).rejects.toThrow();

    const secondProcess = new FileDurableControlPlaneStore(storeFile);
    const restarted = new DurableMultiAgentCoordinator({
      store: secondProcess,
      agentDispatch: dispatch,
      devGovDispatch: new NoOpDevGov(),
    });
    expect(secondProcess.pendingOutbox()).toHaveLength(1);
    await restarted.flushPending();
    expect(secondProcess.pendingOutbox()).toHaveLength(0);
  });

  it('5. stale worker after lease reclaim cannot complete or release the item it no longer holds', async () => {
    const mailboxFile = tmpFile('mimer-mailbox-');
    const box = new FileAgentMailbox(mailboxFile);
    const work: AgentWorkItem = {
      dispatchKey: 'K1:3:VERIFIER',
      unit: unit(),
      role: 'VERIFIER',
      reason: 'verify',
    };
    await box.dispatch(work);
    const staleWorker = box.reserve('VERIFIER', 'worker-A', new Date('2026-09-05T01:00:00Z'), 1_000);
    expect(staleWorker?.status).toBe('LEASED');

    expect(box.reclaimExpired(new Date('2026-09-05T01:00:02Z'))).toBe(1);
    box.reserve('VERIFIER', 'worker-B', new Date('2026-09-05T01:00:03Z'));

    expect(() => box.complete('K1:3:VERIFIER', 'worker-A')).toThrow(AgentMailboxConflictError);
    expect(() => box.release('K1:3:VERIFIER', 'worker-A')).toThrow(AgentMailboxConflictError);
  });

  it('6. candidate superseded during run: a handoff bound to a different candidate SHA than canonical is denied, not silently accepted', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const coordinator = new DurableMultiAgentCoordinator({
      store,
      agentDispatch: new FlakyAgentDispatch(0),
      devGovDispatch: new NoOpDevGov(),
    });
    await expect(
      coordinator.acceptHandoff(verifierPassHandoff({ observedCandidateSha: '9'.repeat(40) })),
    ).rejects.toThrow(/candidate SHA/);
    expect(store.read().units.K1.state).toBe('VERIFYING');
  });

  it('7. result delivered twice: identical redelivery is idempotent, but agent-run-id reuse with different content is rejected outright', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const coordinator = new DurableMultiAgentCoordinator({
      store,
      agentDispatch: new FlakyAgentDispatch(0),
      devGovDispatch: new NoOpDevGov(),
    });

    const first = await coordinator.acceptHandoff(verifierPassHandoff());
    expect(first.duplicate).toBe(false);
    const redelivered = await coordinator.acceptHandoff(verifierPassHandoff());
    expect(redelivered.duplicate).toBe(true);
    expect(redelivered.state.state).toBe(first.state.state);

    await expect(
      coordinator.acceptHandoff(
        verifierPassHandoff({
          findings: [
            {
              id: 'f1',
              severity: 'NON_BLOCKING',
              classification: 'MECHANICAL',
              message: 'reused run id, different content',
            },
          ],
        }),
      ),
    ).rejects.toThrow(DuplicateHandoffConflictError);
  });

  it('8. result delivered out of order: a late handoff whose input_state no longer matches canonical is rejected, not applied on top of newer state', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit());
    const coordinator = new DurableMultiAgentCoordinator({
      store,
      agentDispatch: new FlakyAgentDispatch(0),
      devGovDispatch: new NoOpDevGov(),
    });
    await coordinator.acceptHandoff(verifierPassHandoff());
    expect(store.read().units.K1.state).toBe('PROVING_RED');

    const lateHandoff = verifierPassHandoff({
      agentRunId: 'codex-late',
      startedAt: '2026-09-05T00:50:00.000Z',
      finishedAt: '2026-09-05T00:59:00.000Z',
    });
    await expect(coordinator.acceptHandoff(lateHandoff)).rejects.toThrow(/stale handoff input_state/);
  });

  it('9. dependency unavailable: the DEV-GOV lane is classified BLOCKED_DEPENDENCY, never treated as a crash or a fabricated pass', async () => {
    const store = new FileDurableControlPlaneStore(tmpFile('mimer-store-'));
    store.initializeUnit(unit({ state: 'GATING', revision: 9 }));
    class Unavailable implements DevGovWorkflowAvailabilityPort {
      async workflowExists() {
        return false;
      }
    }
    class NeverAsked implements DevGovCommitStatusObserverPort {
      async getStatus(): Promise<undefined> {
        throw new Error('must not be consulted before dependency availability is known');
      }
    }
    const correlator = new WorkflowDispatchCorrelator(
      new FileCorrelationStore(tmpFile('mimer-correlation-')),
      { getRefSha: async () => '0'.repeat(40), dispatchWorkflow: async () => {} },
      { listRuns: async () => [] },
    );
    const reconciler = new DevGovReconciler(
      store,
      new Unavailable(),
      correlator,
      new NeverAsked(),
      () => new Date('2026-09-05T01:00:00.000Z'),
    );
    const outcome = await reconciler.reconcile({
      expectedUnitId: 'K1',
      expectedRevision: 9,
      workflow: 'devgov-v0-orchestrate.yml',
      protectedRef: 'main',
    });
    expect(outcome).toMatchObject({ kind: 'BLOCKED_DEPENDENCY_APPLIED' });
    expect(store.read().units.K1.state).toBe('BLOCKED_DEPENDENCY');
  });

  it('10. cancellation while external work is running stops the process and dead-letters the item instead of retrying forever', async () => {
    const mailboxFile = tmpFile('mimer-mailbox-');
    const box = new FileAgentMailbox(mailboxFile);
    const work: AgentWorkItem = {
      dispatchKey: 'K1:3:VERIFIER',
      unit: unit(),
      role: 'VERIFIER',
      reason: 'verify',
    };
    await box.dispatch(work);

    let capturedSignal: AbortSignal | undefined;
    const executor: AgentProcessExecutor = {
      execute(_work, signal) {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new AgentProcessCancelledError('killed on cancellation')),
          );
        });
      },
    };
    const sink: AgentHandoffSink = { async accept() {} };
    const worker = new ProcessAgentWorker(box, executor, sink, { workerId: 'worker-A', role: 'VERIFIER' });

    const runPromise = worker.runOnce();
    expect(capturedSignal?.aborted).toBe(false);
    expect(worker.requestCancellation('K1:3:VERIFIER')).toBe(true);
    await expect(runPromise).resolves.toBe('CANCELLED');
    expect(box.list()[0]).toMatchObject({ status: 'DEAD_LETTER' });
    expect(box.list()[0].lastError).toMatch(/cancelled/);
    expect(worker.requestCancellation('K1:3:VERIFIER')).toBe(false);
  });
});
