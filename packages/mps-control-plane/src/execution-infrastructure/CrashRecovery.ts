import type { ExecutionTicketQueue } from "../ExecutionTicketQueue.js";
import type { RetryEngine } from "./RetryEngine.js";
import type { AttemptCounterStore } from "./AttemptCounter.js";
import type { CrashRecoveryReport } from "./types.js";
import type { ReplayScheduler } from "./ReplayScheduler.js";

/**
 * Crash recovery: reclaim is performed by the durable queue on reserve;
 * this coordinator retries failed tickets per RetryEngine and reports pending replays.
 *
 * Invariant: an execution can resume after process death without information loss
 * when tickets are durable (Prisma/file) and recover() runs on boot / before reserve.
 */
export class CrashRecovery {
  constructor(
    private readonly queue: ExecutionTicketQueue,
    private readonly retryEngine: RetryEngine,
    private readonly attempts: AttemptCounterStore,
    private readonly replayScheduler?: ReplayScheduler,
  ) {}

  /**
   * Re-queue failed tickets that are still retryable.
   * Lease reclaim happens inside queue.reserve / queue.reclaimExpiredLeases.
   */
  async recoverFailed(): Promise<{ retried: number }> {
    if (!this.queue.list) {
      return { retried: 0 };
    }
    const failed = await this.queue.list("failed");
    let retried = 0;
    for (const ticket of failed) {
      const attempts = await this.attempts.get(ticket.ticket_id);
      // Peek: would one more failure-cycle still be retryable?
      const decision = this.retryEngine.decide({
        attempts_so_far: Math.max(attempts, 1),
        fail_reason: "crash_recovery",
      });
      if (decision.action === "retry") {
        await this.queue.retry(ticket.ticket_id);
        retried += 1;
      }
    }
    return { retried };
  }

  async report(): Promise<CrashRecoveryReport> {
    const { retried } = await this.recoverFailed();
    let reclaimed = 0;
    if (this.queue.reclaimExpiredLeases) {
      reclaimed = await this.queue.reclaimExpiredLeases();
    }
    const replay_jobs_pending = this.replayScheduler
      ? await this.replayScheduler.pendingCount()
      : 0;
    return {
      reclaimed_leases: reclaimed,
      retried_failures: retried,
      replay_jobs_pending,
    };
  }
}
