import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FileCorrelationStore,
  RepositoryDispatchCorrelator,
  type GitHubActionsRunObserverPort,
  type GitHubRepositoryDispatchPort,
  type ObservedWorkflowRun,
} from '../../../packages/mps-control-plane/src/multi-agent';

const roots: string[] = [];
const refSha = '4'.repeat(40);
const workflow = 'devgov-v0-orchestrate.yml';
const eventType = 'devgov-v0-orchestrate';
const ref = 'main';
const dispatchedAtIso = '2026-09-05T01:00:00.000Z';

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function store(): FileCorrelationStore {
  const root = mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-'));
  roots.push(root);
  return new FileCorrelationStore(path.join(root, 'correlation.json'));
}

class DispatchPort implements GitHubRepositoryDispatchPort {
  calls: Array<Parameters<GitHubRepositoryDispatchPort['dispatchRepositoryEvent']>[0]> = [];
  constructor(private readonly sha = refSha) {}
  async getRefSha() {
    return this.sha;
  }
  async dispatchRepositoryEvent(
    input: Parameters<GitHubRepositoryDispatchPort['dispatchRepositoryEvent']>[0],
  ) {
    this.calls.push(input);
  }
}

class RunObserver implements GitHubActionsRunObserverPort {
  constructor(public runs: ObservedWorkflowRun[] = []) {}
  async listRuns() {
    return this.runs;
  }
}

/**
 * A run that matches the standard fixture dispatch exactly on every bound
 * dimension, including `displayTitle` — which mirrors
 * `devgov-v0-orchestrate.yml`'s real `run-name:` echo of
 * `client_payload.candidate_sha` — containing the same `candidate_sha`
 * ('x') the standard `dispatchedFixture()` helper below dispatches with.
 */
function validRun(overrides: Partial<ObservedWorkflowRun> = {}): ObservedWorkflowRun {
  return {
    runId: '1001',
    workflow,
    headBranch: ref,
    headSha: refSha,
    event: 'repository_dispatch',
    displayTitle: 'DEV-GOV orchestrate x unit=governance/devgov/units/example.json',
    createdAt: '2026-09-05T01:00:05.000Z',
    status: 'completed',
    conclusion: 'success',
    htmlUrl: 'https://github.com/x/y/actions/runs/1001',
    ...overrides,
  };
}

function correlator(
  observer: GitHubActionsRunObserverPort,
  opts: { now?: () => Date; windowMs?: number } = {},
) {
  return new RepositoryDispatchCorrelator(store(), new DispatchPort(), observer, {
    now: opts.now ?? (() => new Date(dispatchedAtIso)),
    windowMs: opts.windowMs,
  });
}

async function dispatchedFixture(
  observer: GitHubActionsRunObserverPort,
  opts: { now?: () => Date; windowMs?: number } = {},
) {
  const corr = correlator(observer, opts);
  await corr.dispatch({
    dispatchKey: 'K1:6:DEV_GOV',
    workflow,
    eventType,
    ref,
    clientPayload: { candidate_sha: 'x' },
  });
  return corr;
}

describe('GitHub workflow-dispatch run correlation — binding (Part B, Blocker 1)', () => {
  it('A. exactly one valid match on every dimension correlates', async () => {
    const corr = await dispatchedFixture(new RunObserver([validRun()]));
    expect(await corr.poll('K1:6:DEV_GOV')).toMatchObject({ status: 'CORRELATED', runId: '1001' });
  });

  it('B. a run for a different workflow is rejected even if every other dimension matches', async () => {
    const corr = await dispatchedFixture(
      new RunObserver([validRun({ workflow: 'some-other-workflow.yml' })]),
    );
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
  });

  it('C. a run on a different ref/head branch is rejected', async () => {
    const corr = await dispatchedFixture(new RunObserver([validRun({ headBranch: 'not-main' })]));
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
  });

  it('D. a run with a different head SHA is rejected', async () => {
    const corr = await dispatchedFixture(new RunObserver([validRun({ headSha: '5'.repeat(40) })]));
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
  });

  it('E. a run from a different event (e.g. push, schedule) is rejected', async () => {
    const corr = await dispatchedFixture(new RunObserver([validRun({ event: 'push' })]));
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
  });

  it('F. a run created before the lower time bound (dispatchedAt) is rejected', async () => {
    const corr = await dispatchedFixture(
      new RunObserver([validRun({ createdAt: '2026-09-05T00:59:59.000Z' })]),
    );
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
  });

  it('G. a run created after the upper time bound (dispatchedAt + windowMs) is rejected', async () => {
    const corr = await dispatchedFixture(
      new RunObserver([validRun({ createdAt: '2026-09-05T01:06:00.000Z' })]),
      { windowMs: 5 * 60_000 },
    );
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
  });

  it('H. zero valid matches keeps polling until the window elapses, then times out — never selects an invalid run instead', async () => {
    let now = new Date(dispatchedAtIso);
    const observer = new RunObserver([
      validRun({ workflow: 'wrong.yml' }),
      validRun({ headBranch: 'wrong-ref' }),
      validRun({ headSha: '9'.repeat(40) }),
      validRun({ event: 'push' }),
    ]);
    const corr = new RepositoryDispatchCorrelator(store(), new DispatchPort(), observer, {
      now: () => now,
      windowMs: 60_000,
    });
    await corr.dispatch({ dispatchKey: 'K1:6:DEV_GOV', workflow, eventType, ref, clientPayload: {} });
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
    now = new Date('2026-09-05T01:01:01.000Z');
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('CORRELATION_TIMEOUT');
  });

  it('I. more than one exact valid match is reported ambiguous, never picked', async () => {
    const corr = await dispatchedFixture(
      new RunObserver([validRun({ runId: '1001' }), validRun({ runId: '1002' })]),
    );
    const resolved = await corr.poll('K1:6:DEV_GOV');
    expect(resolved.status).toBe('AMBIGUOUS_CORRELATION');
    expect(resolved.candidateRunIds).toEqual(['1001', '1002']);
  });

  it('J. pagination: the valid run is found regardless of how many other runs the observer returns or in what order — the correlator scans the whole set, it never caps or slices', async () => {
    const decoys = Array.from({ length: 250 }, (_, i) =>
      validRun({ runId: `decoy-${i}`, headSha: '8'.repeat(40) }),
    );
    const runs = [...decoys.slice(0, 120), validRun({ runId: 'the-real-one' }), ...decoys.slice(120)];
    const corr = await dispatchedFixture(new RunObserver(runs));
    expect(await corr.poll('K1:6:DEV_GOV')).toMatchObject({ status: 'CORRELATED', runId: 'the-real-one' });
  });

  it('K. eventual consistency: an empty first poll does not time out or select a decoy — the valid run appearing on a later poll still correlates', async () => {
    const observer = new RunObserver([]);
    const corr = await dispatchedFixture(observer, { windowMs: 5 * 60_000 });
    expect((await corr.poll('K1:6:DEV_GOV')).status).toBe('AWAITING_RUN');
    observer.runs = [validRun()];
    expect(await corr.poll('K1:6:DEV_GOV')).toMatchObject({ status: 'CORRELATED', runId: '1001' });
  });

  it('L. FA-02: two concurrent repository_dispatch calls for DIFFERENT candidate_sha values sharing an identical headSha are never cross-bound — display_title (run-name-echoed candidate_sha) disambiguates where headSha cannot', async () => {
    // repository_dispatch always resolves/executes the SAME default-branch
    // tip regardless of which call triggered it, so two concurrent dispatches
    // of this workflow get the SAME headSha — workflow/headBranch/headSha/
    // event/time-window alone cannot tell them apart. This reproduces the
    // exact scenario the falsifier described: dispatch A (candidate-x) then
    // dispatch B (candidate-y) close together; only run-a has surfaced so
    // far. Without the display_title check, run-a would satisfy every other
    // dimension for record_B too and get permanently, wrongly bound to it.
    const dispatchPort = new DispatchPort();
    const observer = new RunObserver([]);
    const corr = new RepositoryDispatchCorrelator(store(), dispatchPort, observer, {
      now: () => new Date(dispatchedAtIso),
    });

    await corr.dispatch({
      dispatchKey: 'K1:6:DEV_GOV:A',
      workflow,
      eventType,
      ref,
      clientPayload: { candidate_sha: 'candidate-x' },
    });
    await corr.dispatch({
      dispatchKey: 'K1:6:DEV_GOV:B',
      workflow,
      eventType,
      ref,
      clientPayload: { candidate_sha: 'candidate-y' },
    });
    expect(dispatchPort.calls).toHaveLength(2);

    // Only run-a (belonging to dispatch A) has surfaced via the API so far.
    // It shares workflow/headBranch/headSha/event/time-window with what a
    // run for dispatch B would look like too, since both DispatchPort calls
    // resolved the same refShaAtDispatch.
    observer.runs = [
      validRun({ runId: 'run-a', displayTitle: 'DEV-GOV orchestrate candidate-x unit=x.json' }),
    ];

    const resolvedA = await corr.poll('K1:6:DEV_GOV:A');
    expect(resolvedA).toMatchObject({ status: 'CORRELATED', runId: 'run-a' });

    // record_B must NOT be incorrectly bound to run-a merely because every
    // OTHER dimension matches — its display_title does not contain
    // candidate-y, so it must still be AWAITING_RUN (or, with more than one
    // decoy present, AMBIGUOUS_CORRELATION) — never a wrong CORRELATED bind.
    const resolvedB = await corr.poll('K1:6:DEV_GOV:B');
    expect(resolvedB.status).toBe('AWAITING_RUN');
    expect(resolvedB.runId).toBeUndefined();

    // Once run-b (whose display_title carries candidate-y) surfaces too,
    // record_B correctly binds to IT, not to run-a — and record_A's own
    // (correct) binding to run-a is unaffected.
    observer.runs = [
      validRun({ runId: 'run-a', displayTitle: 'DEV-GOV orchestrate candidate-x unit=x.json' }),
      validRun({ runId: 'run-b', displayTitle: 'DEV-GOV orchestrate candidate-y unit=y.json' }),
    ];
    const resolvedB2 = await corr.poll('K1:6:DEV_GOV:B');
    expect(resolvedB2).toMatchObject({ status: 'CORRELATED', runId: 'run-b' });
    const resolvedA2 = await corr.poll('K1:6:DEV_GOV:A');
    expect(resolvedA2).toMatchObject({ status: 'CORRELATED', runId: 'run-a' });
  });

  it('is idempotent per dispatchKey: a second dispatch call never re-submits repository_dispatch once accepted', async () => {
    const dispatchPort = new DispatchPort();
    const corr = new RepositoryDispatchCorrelator(store(), dispatchPort, new RunObserver(), {
      now: () => new Date(dispatchedAtIso),
    });
    const input = { dispatchKey: 'K1:6:DEV_GOV', workflow, eventType, ref, clientPayload: {} };
    await corr.dispatch(input);
    await corr.dispatch(input);
    expect(dispatchPort.calls).toHaveLength(1);
  });

  it('survives restart: a fresh correlator instance over the same store resumes polling', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));
    const dispatchPort = new DispatchPort();
    const before = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver(),
      {
        now: () => new Date(dispatchedAtIso),
      },
    );
    await before.dispatch({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      clientPayload: { candidate_sha: 'x' },
    });

    const after = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver([validRun()]),
      {
        now: () => new Date('2026-09-05T01:00:05.000Z'),
      },
    );
    const resumed = await after.pollAllPending();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ status: 'CORRELATED', runId: '1001' });
    expect(dispatchPort.calls).toHaveLength(1);
  });
});

describe('GitHub workflow-dispatch crash window (Part B/E, Blocker 2)', () => {
  it('C1. crash before the external dispatch call: restart sees no dispatchAttemptedAt marker and safely dispatches', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));

    // Simulate "crashed after forming intent, before ever calling GitHub":
    // persist the UNCERTAIN_DISPATCH intent record directly, bypassing the
    // real dispatch path, exactly as if the process had died right there.
    const crashedStore = new FileCorrelationStore(filePath);
    crashedStore.createIfAbsent({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      refShaAtDispatch: refSha,
      clientPayload: {},
      dispatchedAt: dispatchedAtIso,
      windowMs: 5 * 60_000,
      status: 'UNCERTAIN_DISPATCH',
      pollCount: 0,
    });

    const dispatchPort = new DispatchPort();
    const restarted = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver(),
      {
        now: () => new Date(dispatchedAtIso),
      },
    );
    const result = await restarted.dispatch({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      clientPayload: {},
    });
    expect(result.status).toBe('AWAITING_RUN');
    expect(dispatchPort.calls).toHaveLength(1);
  });

  it('C2. crash after GitHub accepted the dispatch but before the accepted marker was persisted: restart must not blindly redispatch', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));

    // Simulate "GitHub already has this run, but our process crashed after
    // persisting dispatchAttemptedAt and before persisting AWAITING_RUN":
    const crashedStore = new FileCorrelationStore(filePath);
    crashedStore.createIfAbsent({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      refShaAtDispatch: refSha,
      clientPayload: {},
      dispatchedAt: dispatchedAtIso,
      windowMs: 5 * 60_000,
      status: 'UNCERTAIN_DISPATCH',
      dispatchAttemptedAt: dispatchedAtIso,
      pollCount: 0,
    });

    const dispatchPort = new DispatchPort();
    const restarted = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver(), // the real run has not surfaced in the API yet
      { now: () => new Date(dispatchedAtIso), uncertainHorizonMs: 5 * 60_000 },
    );
    const result = await restarted.dispatch({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      clientPayload: {},
    });
    expect(result.status).toBe('UNCERTAIN_DISPATCH');
    expect(dispatchPort.calls).toHaveLength(0); // must NOT have blindly redispatched
  });

  it('eventual successful correlation after an uncertain restart: the run surfaces before the retry horizon, so it is bound and no redispatch ever happens', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));
    new FileCorrelationStore(filePath).createIfAbsent({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      refShaAtDispatch: refSha,
      clientPayload: { candidate_sha: 'x' },
      dispatchedAt: dispatchedAtIso,
      windowMs: 5 * 60_000,
      status: 'UNCERTAIN_DISPATCH',
      dispatchAttemptedAt: dispatchedAtIso,
      pollCount: 0,
    });

    const dispatchPort = new DispatchPort();
    const restarted = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver([validRun()]), // the earlier attempt DID reach GitHub; the run now shows up
      { now: () => new Date(dispatchedAtIso), uncertainHorizonMs: 5 * 60_000 },
    );
    const result = await restarted.dispatch({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      clientPayload: { candidate_sha: 'x' },
    });
    expect(result).toMatchObject({ status: 'CORRELATED', runId: '1001' });
    expect(dispatchPort.calls).toHaveLength(0); // resolved via correlation, never redispatched
  });

  it('ambiguity found while resolving an uncertain restart remains fail-closed: reported ambiguous, never redispatched and never silently picked', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));
    new FileCorrelationStore(filePath).createIfAbsent({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      refShaAtDispatch: refSha,
      clientPayload: { candidate_sha: 'x' },
      dispatchedAt: dispatchedAtIso,
      windowMs: 5 * 60_000,
      status: 'UNCERTAIN_DISPATCH',
      dispatchAttemptedAt: dispatchedAtIso,
      pollCount: 0,
    });

    const dispatchPort = new DispatchPort();
    const restarted = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver([validRun({ runId: '1001' }), validRun({ runId: '1002' })]),
      { now: () => new Date(dispatchedAtIso), uncertainHorizonMs: 5 * 60_000 },
    );
    const result = await restarted.dispatch({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      clientPayload: { candidate_sha: 'x' },
    });
    expect(result.status).toBe('AMBIGUOUS_CORRELATION');
    expect(dispatchPort.calls).toHaveLength(0);
  });

  it('no blind duplicate dispatch: an uncertain record still within the retry horizon is left uncertain, not redispatched, even after several restarts', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));
    new FileCorrelationStore(filePath).createIfAbsent({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      refShaAtDispatch: refSha,
      clientPayload: {},
      dispatchedAt: dispatchedAtIso,
      windowMs: 5 * 60_000,
      status: 'UNCERTAIN_DISPATCH',
      dispatchAttemptedAt: dispatchedAtIso,
      pollCount: 0,
    });

    const dispatchPort = new DispatchPort();
    const laterButWithinHorizon = new Date('2026-09-05T01:02:00.000Z');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const restarted = new RepositoryDispatchCorrelator(
        new FileCorrelationStore(filePath),
        dispatchPort,
        new RunObserver(),
        {
          now: () => laterButWithinHorizon,
          uncertainHorizonMs: 5 * 60_000,
        },
      );
      const result = await restarted.dispatch({
        dispatchKey: 'K1:6:DEV_GOV',
        workflow,
        eventType,
        ref,
        clientPayload: {},
      });
      expect(result.status).toBe('UNCERTAIN_DISPATCH');
    }
    expect(dispatchPort.calls).toHaveLength(0);
  });

  it('beyond the conservative horizon with still no matching run, a retry dispatch is finally attempted — and is itself durably marked before the network call', async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), 'mimer-run-correlation-')),
      'correlation.json',
    );
    roots.push(path.dirname(filePath));
    new FileCorrelationStore(filePath).createIfAbsent({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      refShaAtDispatch: refSha,
      clientPayload: {},
      dispatchedAt: dispatchedAtIso,
      windowMs: 5 * 60_000,
      status: 'UNCERTAIN_DISPATCH',
      dispatchAttemptedAt: dispatchedAtIso,
      pollCount: 0,
    });

    const dispatchPort = new DispatchPort();
    const wellPastHorizon = new Date('2026-09-05T01:10:01.000Z');
    const restarted = new RepositoryDispatchCorrelator(
      new FileCorrelationStore(filePath),
      dispatchPort,
      new RunObserver(),
      {
        now: () => wellPastHorizon,
        uncertainHorizonMs: 5 * 60_000,
      },
    );
    const result = await restarted.dispatch({
      dispatchKey: 'K1:6:DEV_GOV',
      workflow,
      eventType,
      ref,
      clientPayload: {},
    });
    expect(result.status).toBe('AWAITING_RUN');
    expect(dispatchPort.calls).toHaveLength(1);
  });

  it('a dispatchRepositoryEvent call that throws leaves the record durably UNCERTAIN_DISPATCH with the attempt marker set, not silently lost', async () => {
    class ThrowingDispatch implements GitHubRepositoryDispatchPort {
      async getRefSha() {
        return refSha;
      }
      async dispatchRepositoryEvent(): Promise<void> {
        throw new Error('network error: response never received');
      }
    }
    const s = store();
    const corr = new RepositoryDispatchCorrelator(s, new ThrowingDispatch(), new RunObserver(), {
      now: () => new Date(dispatchedAtIso),
    });
    await expect(
      corr.dispatch({ dispatchKey: 'K1:6:DEV_GOV', workflow, eventType, ref, clientPayload: {} }),
    ).rejects.toThrow(/network error/);
    const record = s.get('K1:6:DEV_GOV');
    expect(record).toMatchObject({ status: 'UNCERTAIN_DISPATCH', dispatchAttemptedAt: dispatchedAtIso });
  });
});
