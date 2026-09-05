import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * GitHub's workflow_dispatch API returns 204 No Content: no run id.
 * Correlation must be reconstructed by observing the Actions runs list,
 * which never echoes back dispatch inputs. The only identifiers available
 * on every run are: workflow id, ref, head_sha, event, and creation time.
 * head_sha-at-dispatch is the strongest of these (display_title is not,
 * since none of the DEV-GOV workflows set `run-name:` from inputs) but it
 * is still shared by every run dispatched against the same commit, so a
 * narrow post-dispatch time window is required and an ambiguous match
 * must be rejected rather than guessed.
 */
export interface GitHubWorkflowDispatchPort {
  /** Returns the current tip SHA of `ref`. Used to bind the pre-dispatch commit identity. */
  getRefSha(ref: string): Promise<string>;
  /** Submits workflow_dispatch. GitHub returns no run id (204 No Content). */
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
  readonly status: "queued" | "in_progress" | "completed";
  readonly conclusion?: "success" | "failure" | "cancelled" | "timed_out" | "action_required" | null;
  readonly htmlUrl: string;
}

export interface GitHubActionsRunObserverPort {
  /** Lists workflow_dispatch runs for `workflow` on `ref`, newest first. */
  listRuns(workflow: string, ref: string): Promise<readonly ObservedWorkflowRun[]>;
}

export type CorrelationStatus =
  | "AWAITING_RUN"
  | "CORRELATED"
  | "AMBIGUOUS_CORRELATION"
  | "CORRELATION_TIMEOUT";

export interface PendingCorrelation {
  readonly dispatchKey: string;
  readonly workflow: string;
  readonly ref: string;
  readonly refShaAtDispatch: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly dispatchedAt: string;
  readonly windowMs: number;
  readonly status: CorrelationStatus;
  readonly runId?: string;
  readonly candidateRunIds?: readonly string[];
  readonly pollCount: number;
  readonly lastPolledAt?: string;
}

interface CorrelationFile {
  readonly schemaVersion: "multi-agent-github-run-correlation-v1";
  readonly records: Readonly<Record<string, PendingCorrelation>>;
}

const EMPTY: CorrelationFile = {
  schemaVersion: "multi-agent-github-run-correlation-v1",
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
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<CorrelationFile>;
    if (parsed.schemaVersion !== "multi-agent-github-run-correlation-v1" || !parsed.records) {
      throw new CorrelationStoreError("run-correlation store is invalid or unsupported");
    }
    return parsed as CorrelationFile;
  }

  private write(value: CorrelationFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

export interface WorkflowDispatchCorrelatorOptions {
  readonly windowMs?: number;
  readonly now?: () => Date;
}

/**
 * Real dispatch -> observe -> correlate -> bind -> persist semantics.
 *
 * Idempotency is local/outbox-level: re-calling `dispatch` for a dispatchKey
 * that already has a pending or resolved correlation record never re-issues
 * workflow_dispatch. This is NOT exactly-once from GitHub's perspective —
 * nothing on the GitHub side guarantees that, and this code makes no such
 * claim. If GitHub ever produces more than one run matching workflow+ref+
 * head_sha inside the correlation window, `poll` reports
 * AMBIGUOUS_CORRELATION and stops advancing rather than picking one.
 */
export class WorkflowDispatchCorrelator {
  private readonly windowMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: FileCorrelationStore,
    private readonly dispatchPort: GitHubWorkflowDispatchPort,
    private readonly observer: GitHubActionsRunObserverPort,
    options: WorkflowDispatchCorrelatorOptions = {},
  ) {
    this.windowMs = options.windowMs ?? 5 * 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async dispatch(input: {
    readonly dispatchKey: string;
    readonly workflow: string;
    readonly ref: string;
    readonly inputs: Readonly<Record<string, string>>;
  }): Promise<PendingCorrelation> {
    const existing = this.store.get(input.dispatchKey);
    if (existing) return existing;

    const refShaAtDispatch = await this.dispatchPort.getRefSha(input.ref);
    const dispatchedAt = this.now().toISOString();
    await this.dispatchPort.dispatchWorkflow({
      workflow: input.workflow,
      ref: input.ref,
      inputs: input.inputs,
    });

    return this.store.createIfAbsent({
      dispatchKey: input.dispatchKey,
      workflow: input.workflow,
      ref: input.ref,
      refShaAtDispatch,
      inputs: input.inputs,
      dispatchedAt,
      windowMs: this.windowMs,
      status: "AWAITING_RUN",
      pollCount: 0,
    });
  }

  /** Caller-driven poll step. No internal timers — a runner loop calls this on its own cadence. */
  async poll(dispatchKey: string): Promise<PendingCorrelation> {
    const record = this.store.get(dispatchKey);
    if (!record) throw new CorrelationStoreError(`unknown correlation dispatch key ${dispatchKey}`);
    if (record.status !== "AWAITING_RUN") return record;

    const nowMs = this.now().getTime();
    const dispatchedAtMs = Date.parse(record.dispatchedAt);
    const runs = await this.observer.listRuns(record.workflow, record.ref);
    const candidates = runs.filter(
      (run) =>
        run.event === "workflow_dispatch" &&
        run.headSha === record.refShaAtDispatch &&
        Date.parse(run.createdAt) >= dispatchedAtMs,
    );

    let next: PendingCorrelation;
    if (candidates.length === 1) {
      next = { ...record, status: "CORRELATED", runId: candidates[0].runId, lastPolledAt: this.now().toISOString(), pollCount: record.pollCount + 1 };
    } else if (candidates.length > 1) {
      next = {
        ...record,
        status: "AMBIGUOUS_CORRELATION",
        candidateRunIds: candidates.map((run) => run.runId),
        lastPolledAt: this.now().toISOString(),
        pollCount: record.pollCount + 1,
      };
    } else if (nowMs - dispatchedAtMs >= record.windowMs) {
      next = { ...record, status: "CORRELATION_TIMEOUT", lastPolledAt: this.now().toISOString(), pollCount: record.pollCount + 1 };
    } else {
      next = { ...record, lastPolledAt: this.now().toISOString(), pollCount: record.pollCount + 1 };
    }

    this.store.update(dispatchKey, next);
    return next;
  }

  /** Restart recovery: resume polling every AWAITING_RUN record from durable state. */
  async pollAllPending(): Promise<readonly PendingCorrelation[]> {
    const pending = this.store.all().filter((record) => record.status === "AWAITING_RUN");
    const results: PendingCorrelation[] = [];
    for (const record of pending) results.push(await this.poll(record.dispatchKey));
    return results;
  }

  async findRun(dispatchKey: string): Promise<ObservedWorkflowRun | undefined> {
    const record = this.store.get(dispatchKey);
    if (!record || record.status !== "CORRELATED" || !record.runId) return undefined;
    const runs = await this.observer.listRuns(record.workflow, record.ref);
    return runs.find((run) => run.runId === record.runId);
  }
}
