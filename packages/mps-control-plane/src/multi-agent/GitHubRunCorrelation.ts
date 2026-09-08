import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * GitHub's workflow_dispatch API returns 204 No Content: no run id. It is
 * also NOT idempotent and offers no idempotency-key mechanism — two calls
 * with identical inputs can produce two runs, and there is no way to ask
 * "did my earlier call already go through?" other than observing the runs
 * list. Correlation must be reconstructed from that list, which never
 * echoes back dispatch inputs either. The only identifiers available on
 * every run are: workflow identity, head branch (ref), head_sha, event,
 * and creation time. head_sha-at-dispatch is the strongest of these
 * (display_title is not, since none of the DEV-GOV workflows set
 * `run-name:` from inputs) but it is still shared by every run dispatched
 * against the same commit, so ALL of workflow + ref + head_sha + event +
 * a bounded creation-time window must match, and an ambiguous match must
 * be rejected rather than guessed.
 */
export interface GitHubWorkflowDispatchPort {
  /** Returns the current tip SHA of `ref`. Used to bind the pre-dispatch commit identity. */
  getRefSha(ref: string): Promise<string>;
  /** Submits workflow_dispatch. GitHub returns no run id (204 No Content). Not idempotent. */
  dispatchWorkflow(input: {
    readonly workflow: string;
    readonly ref: string;
    readonly inputs: Readonly<Record<string, string>>;
  }): Promise<void>;
}

export interface ObservedWorkflowRun {
  readonly runId: string;
  readonly workflow: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly event: string;
  readonly createdAt: string;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'action_required' | null;
  readonly htmlUrl: string;
}

export interface GitHubActionsRunObserverPort {
  /**
   * Returns every workflow_dispatch run for `workflow` on `ref` — the
   * complete result set, with all pages of the underlying GitHub list-runs
   * API already followed. The correlator does not paginate itself and
   * trusts this contract; it never truncates or caps what it scans, so a
   * conforming implementation cannot cause a valid run to be missed by
   * returning only a partial page.
   */
  listRuns(workflow: string, ref: string): Promise<readonly ObservedWorkflowRun[]>;
}

export type CorrelationStatus =
  /** Durable intent persisted; whether GitHub ever received the dispatch is unknown. */
  'UNCERTAIN_DISPATCH' | 'AWAITING_RUN' | 'CORRELATED' | 'AMBIGUOUS_CORRELATION' | 'CORRELATION_TIMEOUT';

export interface PendingCorrelation {
  readonly dispatchKey: string;
  readonly workflow: string;
  readonly ref: string;
  readonly refShaAtDispatch: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly dispatchedAt: string;
  readonly windowMs: number;
  readonly status: CorrelationStatus;
  /** Set the moment an external dispatchWorkflow call is actually made — presence means GitHub may have received it, even if that call then throws or the process crashes. */
  readonly dispatchAttemptedAt?: string;
  readonly runId?: string;
  readonly candidateRunIds?: readonly string[];
  readonly pollCount: number;
  readonly lastPolledAt?: string;
}

interface CorrelationFile {
  readonly schemaVersion: 'multi-agent-github-run-correlation-v1';
  readonly records: Readonly<Record<string, PendingCorrelation>>;
}

const EMPTY: CorrelationFile = {
  schemaVersion: 'multi-agent-github-run-correlation-v1',
  records: {},
};

export class CorrelationStoreError extends Error {}

/**
 * Durable, file-backed correlation ledger. Atomic tmp-write + rename, same
 * discipline as FileAgentMailbox / FileDurableControlPlaneStore, so a
 * process restart resumes polling from exactly where it left off instead
 * of losing the dispatch-to-run binding or re-dispatching.
 */
export class FileCorrelationStore {
  constructor(private readonly filePath: string) {}

  get(dispatchKey: string): PendingCorrelation | undefined {
    return this.read().records[dispatchKey];
  }

  all(): readonly PendingCorrelation[] {
    return Object.values(this.read().records);
  }

  createIfAbsent(record: PendingCorrelation): PendingCorrelation {
    const current = this.read();
    const existing = current.records[record.dispatchKey];
    if (existing) return existing;
    this.write({ ...current, records: { ...current.records, [record.dispatchKey]: record } });
    return record;
  }

  update(dispatchKey: string, next: PendingCorrelation): void {
    const current = this.read();
    if (!current.records[dispatchKey]) {
      throw new CorrelationStoreError(`unknown correlation dispatch key ${dispatchKey}`);
    }
    this.write({ ...current, records: { ...current.records, [dispatchKey]: next } });
  }

  private read(): CorrelationFile {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) return EMPTY;
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<CorrelationFile>;
    if (parsed.schemaVersion !== 'multi-agent-github-run-correlation-v1' || !parsed.records) {
      throw new CorrelationStoreError('run-correlation store is invalid or unsupported');
    }
    return parsed as CorrelationFile;
  }

  private write(value: CorrelationFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }
}

export interface WorkflowDispatchCorrelatorOptions {
  readonly windowMs?: number;
  /** How long to wait for a matching run to surface before an UNCERTAIN_DISPATCH is deemed safe to retry. Defaults to windowMs. */
  readonly uncertainHorizonMs?: number;
  readonly now?: () => Date;
}

function matchCandidates(
  record: PendingCorrelation,
  runs: readonly ObservedWorkflowRun[],
): readonly ObservedWorkflowRun[] {
  const dispatchedAtMs = Date.parse(record.dispatchedAt);
  const upperBoundMs = dispatchedAtMs + record.windowMs;
  return runs.filter(
    (run) =>
      run.workflow === record.workflow &&
      run.headBranch === record.ref &&
      run.headSha === record.refShaAtDispatch &&
      run.event === 'workflow_dispatch' &&
      Date.parse(run.createdAt) >= dispatchedAtMs &&
      Date.parse(run.createdAt) <= upperBoundMs,
  );
}

/**
 * Real dispatch -> observe -> correlate -> bind -> persist semantics.
 *
 * Idempotency is local/outbox-level: re-calling `dispatch` for a dispatchKey
 * that already has a pending or resolved correlation record never blindly
 * re-issues workflow_dispatch. This is NOT exactly-once from GitHub's
 * perspective — nothing on the GitHub side guarantees that, GitHub's
 * workflow_dispatch is not idempotent, and this code makes no exactly-once
 * claim. If GitHub ever produces more than one run matching workflow+ref+
 * head_sha+event inside the correlation window, `poll` reports
 * AMBIGUOUS_CORRELATION and stops advancing rather than picking one.
 *
 * Crash safety: durable intent (status UNCERTAIN_DISPATCH) is persisted
 * BEFORE any external side effect, and `dispatchAttemptedAt` is persisted
 * immediately before the actual dispatchWorkflow call — before the network
 * call is even made, not after. A crash at any point before that write
 * leaves a record with no dispatchAttemptedAt, which is safe to dispatch
 * fresh on restart. A crash at or after that write leaves a record that
 * must not be blindly redispatched: `dispatch()` first tries to resolve it
 * via correlation, and only retries the external call once a conservative
 * horizon has passed with no matching run found.
 */
export class WorkflowDispatchCorrelator {
  private readonly windowMs: number;
  private readonly uncertainHorizonMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: FileCorrelationStore,
    private readonly dispatchPort: GitHubWorkflowDispatchPort,
    private readonly observer: GitHubActionsRunObserverPort,
    options: WorkflowDispatchCorrelatorOptions = {},
  ) {
    this.windowMs = options.windowMs ?? 5 * 60_000;
    this.uncertainHorizonMs = options.uncertainHorizonMs ?? this.windowMs;
    this.now = options.now ?? (() => new Date());
  }

  async dispatch(input: {
    readonly dispatchKey: string;
    readonly workflow: string;
    readonly ref: string;
    readonly inputs: Readonly<Record<string, string>>;
  }): Promise<PendingCorrelation> {
    let record = this.store.get(input.dispatchKey);
    if (!record) {
      const refShaAtDispatch = await this.dispatchPort.getRefSha(input.ref);
      record = this.store.createIfAbsent({
        dispatchKey: input.dispatchKey,
        workflow: input.workflow,
        ref: input.ref,
        refShaAtDispatch,
        inputs: input.inputs,
        dispatchedAt: this.now().toISOString(),
        windowMs: this.windowMs,
        status: 'UNCERTAIN_DISPATCH',
        pollCount: 0,
      });
    }

    if (record.status !== 'UNCERTAIN_DISPATCH') return record;

    if (!record.dispatchAttemptedAt) {
      // No external call was ever made for this intent (or the process
      // crashed before making one) — safe to dispatch now.
      return this.attemptExternalDispatch(record);
    }

    // A previous attempt may already have reached GitHub before a crash or
    // error. Never blindly redispatch: try to resolve it via correlation
    // first, using the exact same bound-candidate matching as poll().
    const resolved = await this.resolveUncertain(record);
    if (resolved.status !== 'UNCERTAIN_DISPATCH') return resolved;

    const sinceAttemptMs = this.now().getTime() - Date.parse(resolved.dispatchAttemptedAt!);
    if (sinceAttemptMs < this.uncertainHorizonMs) {
      // Still within the conservative horizon: no matching run has
      // surfaced yet, but it may simply not be visible via the API yet
      // (eventual consistency). Do not redispatch, do not claim success.
      return resolved;
    }

    // Beyond the horizon with no matching run ever found — the earlier
    // attempt almost certainly never reached GitHub (or its run has long
    // since expired from any reasonable correlation window). Retrying now
    // is the least-bad option; this is still not exactly-once.
    return this.attemptExternalDispatch(resolved);
  }

  /** Caller-driven poll step. No internal timers — a runner loop calls this on its own cadence. */
  async poll(dispatchKey: string): Promise<PendingCorrelation> {
    const record = this.store.get(dispatchKey);
    if (!record) throw new CorrelationStoreError(`unknown correlation dispatch key ${dispatchKey}`);
    if (record.status !== 'AWAITING_RUN' && record.status !== 'UNCERTAIN_DISPATCH') return record;

    const resolved = await this.resolveUncertain(record);
    this.store.update(dispatchKey, resolved);
    return resolved;
  }

  /**
   * Shared bound-candidate resolution for both AWAITING_RUN and
   * UNCERTAIN_DISPATCH records. Never itself issues a dispatch — pure
   * observation. Binds on workflow identity, ref/head branch, head SHA,
   * the workflow_dispatch event, and a closed creation-time window
   * (dispatchedAt .. dispatchedAt + windowMs) — every dimension the
   * candidate set is scoped by, defense-in-depth against a port
   * implementation that did not already filter correctly. Scans the
   * entire array the observer port returns with no slicing/capping, so a
   * conforming (fully-paginated) port cannot have a valid run missed here.
   */
  private async resolveUncertain(record: PendingCorrelation): Promise<PendingCorrelation> {
    const runs = await this.observer.listRuns(record.workflow, record.ref);
    const candidates = matchCandidates(record, runs);
    const polledAt = this.now().toISOString();

    if (candidates.length === 1) {
      return {
        ...record,
        status: 'CORRELATED',
        runId: candidates[0].runId,
        lastPolledAt: polledAt,
        pollCount: record.pollCount + 1,
      };
    }
    if (candidates.length > 1) {
      return {
        ...record,
        status: 'AMBIGUOUS_CORRELATION',
        candidateRunIds: candidates.map((run) => run.runId),
        lastPolledAt: polledAt,
        pollCount: record.pollCount + 1,
      };
    }

    // Zero valid matches. Never select an invalid run merely because the
    // valid one is not visible yet (eventual consistency) — just record
    // that we looked, and let the caller decide what "no match yet" means
    // (poll() times out an AWAITING_RUN past its window; dispatch() decides
    // whether an UNCERTAIN_DISPATCH is now safe to retry).
    if (record.status === 'AWAITING_RUN') {
      const nowMs = this.now().getTime();
      const dispatchedAtMs = Date.parse(record.dispatchedAt);
      if (nowMs - dispatchedAtMs >= record.windowMs) {
        return {
          ...record,
          status: 'CORRELATION_TIMEOUT',
          lastPolledAt: polledAt,
          pollCount: record.pollCount + 1,
        };
      }
    }
    return { ...record, lastPolledAt: polledAt, pollCount: record.pollCount + 1 };
  }

  private async attemptExternalDispatch(record: PendingCorrelation): Promise<PendingCorrelation> {
    // Persist the "an external call is happening now" marker BEFORE making
    // the network call, so even a crash mid-call (or immediately after,
    // before any response is processed) leaves durable evidence that this
    // dispatch must be treated as uncertain, not safely retryable.
    const attempted: PendingCorrelation = { ...record, dispatchAttemptedAt: this.now().toISOString() };
    this.store.update(record.dispatchKey, attempted);

    await this.dispatchPort.dispatchWorkflow({
      workflow: record.workflow,
      ref: record.ref,
      inputs: record.inputs,
    });

    const accepted: PendingCorrelation = { ...attempted, status: 'AWAITING_RUN' };
    this.store.update(record.dispatchKey, accepted);
    return accepted;
  }

  /** Restart recovery: resume resolving every unresolved record from durable state. */
  async pollAllPending(): Promise<readonly PendingCorrelation[]> {
    const pending = this.store
      .all()
      .filter((record) => record.status === 'AWAITING_RUN' || record.status === 'UNCERTAIN_DISPATCH');
    const results: PendingCorrelation[] = [];
    for (const record of pending) results.push(await this.poll(record.dispatchKey));
    return results;
  }

  async findRun(dispatchKey: string): Promise<ObservedWorkflowRun | undefined> {
    const record = this.store.get(dispatchKey);
    if (!record || record.status !== 'CORRELATED' || !record.runId) return undefined;
    const runs = await this.observer.listRuns(record.workflow, record.ref);
    return runs.find((run) => run.runId === record.runId);
  }
}
