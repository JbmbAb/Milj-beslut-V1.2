import type {
  FrozenExecutionTicket,
  ExecutionTicketStatus,
} from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import {
  createPendingTicket,
  type ExecutionTicketQueue,
} from "../ExecutionTicketQueue.js";
import { LeaseManager } from "./LeaseManager.js";
import { RetryEngine } from "./RetryEngine.js";
import { IdempotencyManager, MemoryIdempotencyStore } from "./IdempotencyManager.js";
import { MemoryAttemptCounterStore, type AttemptCounterStore } from "./AttemptCounter.js";
import { CrashRecovery } from "./CrashRecovery.js";
import { ReplayScheduler, MemoryReplayJobStore } from "./ReplayScheduler.js";
import type {
  CrashRecoveryReport,
  InfrastructureClock,
  ReplayScheduleJob,
  RetryPolicy,
} from "./types.js";
import { DEFAULT_EXECUTION_POLICY } from "../../../mps-runtime/src/contracts/model/ExecutionPolicies.js";

export type ExecutionInfrastructureOptions = {
  readonly leaseTimeoutMs?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly now?: () => Date;
  readonly attemptStore?: AttemptCounterStore;
};

/**
 * Execution Platform 2.1 facade — domain-agnostic.
 * Composes durable ExecutionTicketQueue with lease/retry/idempotency/recovery/replay schedule.
 */
export class ExecutionInfrastructure {
  readonly leaseManager: LeaseManager;
  readonly retryEngine: RetryEngine;
  readonly idempotency: IdempotencyManager;
  readonly replayScheduler: ReplayScheduler;
  readonly crashRecovery: CrashRecovery;
  private readonly attempts: AttemptCounterStore;
  private readonly clock: InfrastructureClock;

  constructor(
    readonly queue: ExecutionTicketQueue,
    options: ExecutionInfrastructureOptions = {},
  ) {
    this.clock = { now: options.now ?? (() => new Date()) };
    const policy = DEFAULT_EXECUTION_POLICY;
    this.leaseManager = new LeaseManager(
      options.leaseTimeoutMs ?? policy.lease_timeout_ms,
      this.clock,
    );
    this.retryEngine = new RetryEngine(options.retryPolicy ?? policy.retry);
    this.idempotency = new IdempotencyManager(new MemoryIdempotencyStore());
    this.attempts = options.attemptStore ?? new MemoryAttemptCounterStore();
    this.replayScheduler = new ReplayScheduler(
      new MemoryReplayJobStore(),
      this.clock,
    );
    this.crashRecovery = new CrashRecovery(
      queue,
      this.retryEngine,
      this.attempts,
      this.replayScheduler,
    );
  }

  /** Boot / pre-reserve recovery — reclaim leases + retry failed. */
  async recover(): Promise<CrashRecoveryReport> {
    return this.crashRecovery.report();
  }

  /**
   * Idempotent enqueue: same key returns existing ticket without rewind.
   */
  async enqueueIdempotent(
    idempotencyKey: string,
    ticket_id: string,
    manifest_ref: ArtifactReference,
  ): Promise<FrozenExecutionTicket> {
    const existingId = await this.idempotency.resolveExisting(idempotencyKey);
    if (existingId) {
      const existing = await this.queue.get(existingId);
      if (existing) return existing;
    }
    const ticket = createPendingTicket(ticket_id, manifest_ref);
    const stored = await this.queue.enqueue(ticket);
    await this.idempotency.remember(idempotencyKey, stored.ticket_id);
    return stored;
  }

  async reserve(worker_id: string): Promise<FrozenExecutionTicket | null> {
    if (this.queue.reclaimExpiredLeases) {
      await this.queue.reclaimExpiredLeases();
    }
    return this.queue.reserve(worker_id);
  }

  async complete(ticket_id: string): Promise<void> {
    await this.queue.complete(ticket_id);
  }

  /**
   * Fail then optionally retry per RetryEngine (idempotent complete path elsewhere).
   */
  async failAndMaybeRetry(
    ticket_id: string,
    reason: string,
  ): Promise<"retried" | "failed"> {
    await this.queue.fail(ticket_id, reason);
    const attempts = await this.attempts.increment(ticket_id);
    const decision = this.retryEngine.decide({
      attempts_so_far: attempts,
      fail_reason: reason,
    });
    if (decision.action === "retry") {
      await this.queue.retry(ticket_id);
      return "retried";
    }
    return "failed";
  }

  async scheduleReplay(input: {
    readonly manifest_ref: ArtifactReference;
    readonly attempt_ref?: ArtifactReference | null;
  }): Promise<ReplayScheduleJob> {
    return this.replayScheduler.schedule(input);
  }

  async nextReplay(worker_id: string): Promise<ReplayScheduleJob | null> {
    return this.replayScheduler.next(worker_id);
  }

  async get(ticket_id: string): Promise<FrozenExecutionTicket | undefined> {
    return this.queue.get(ticket_id);
  }
}

export function createExecutionInfrastructure(
  queue: ExecutionTicketQueue,
  options?: ExecutionInfrastructureOptions,
): ExecutionInfrastructure {
  return new ExecutionInfrastructure(queue, options);
}

export type { ExecutionTicketStatus };
