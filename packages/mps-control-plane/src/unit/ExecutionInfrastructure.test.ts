import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryExecutionTicketQueue, createPendingTicket } from "../ExecutionTicketQueue.js";
import { createExecutionInfrastructure } from "../execution-infrastructure/ExecutionInfrastructure.js";
import { RetryEngine } from "../execution-infrastructure/RetryEngine.js";
import { LeaseManager } from "../execution-infrastructure/LeaseManager.js";
import { AdmittedTicketWorker } from "../AdmittedTicketWorker.js";

describe("Execution Infrastructure 2.1", () => {
  let nowMs: number;

  beforeEach(() => {
    nowMs = Date.parse("2026-08-06T00:00:00.000Z");
  });

  function infra(leaseTimeoutMs = 1000) {
    const queue = new InMemoryExecutionTicketQueue({
      leaseTimeoutMs,
      now: () => new Date(nowMs),
    });
    return createExecutionInfrastructure(queue, {
      leaseTimeoutMs,
      retryPolicy: { max_attempts: 3, delay_ms: 0 },
      now: () => new Date(nowMs),
    });
  }

  it("LeaseManager reclaims after timeout", () => {
    const lm = new LeaseManager(500, { now: () => new Date(nowMs) });
    const issued = lm.issue("t1", "w1");
    expect(lm.decide(issued.leased_at).action).toBe("hold");
    nowMs += 501;
    expect(lm.decide(issued.leased_at).action).toBe("reclaim");
  });

  it("RetryEngine is deterministic and respects max_attempts", () => {
    const engine = new RetryEngine({ max_attempts: 2, delay_ms: 0 });
    expect(engine.decide({ attempts_so_far: 1, fail_reason: "x" }).action).toBe("retry");
    expect(engine.decide({ attempts_so_far: 2, fail_reason: "x" }).action).toBe("give_up");
  });

  it("idempotent enqueue returns same ticket", async () => {
    const ei = infra();
    const a = await ei.enqueueIdempotent("key-1", "ticket-1", {
      artifact_id: "m-1",
      artifact_type: "execution_manifest",
    });
    const b = await ei.enqueueIdempotent("key-1", "ticket-other", {
      artifact_id: "m-1",
      artifact_type: "execution_manifest",
    });
    expect(b.ticket_id).toBe(a.ticket_id);
    expect(b.status).toBe("pending");
  });

  it("crash recovery reclaims expired lease without information loss", async () => {
    const ei = infra(1000);
    await ei.enqueueIdempotent("k", "t-crash", {
      artifact_id: "m-crash",
      artifact_type: "execution_manifest",
    });
    await ei.reserve("dead-worker");
    nowMs += 1001;
    const report = await ei.recover();
    expect(report.reclaimed_leases).toBe(1);
    const again = await ei.reserve("live-worker");
    expect(again?.ticket_id).toBe("t-crash");
    expect(again?.lease_ref).toContain("live-worker");
  });

  it("failAndMaybeRetry then give up after max attempts", async () => {
    const ei = infra();
    await ei.enqueueIdempotent("k2", "t-retry", {
      artifact_id: "m-r",
      artifact_type: "execution_manifest",
    });
    await ei.reserve("w1");
    expect(await ei.failAndMaybeRetry("t-retry", "boom")).toBe("retried");
    await ei.reserve("w1");
    expect(await ei.failAndMaybeRetry("t-retry", "boom")).toBe("retried");
    await ei.reserve("w1");
    expect(await ei.failAndMaybeRetry("t-retry", "boom")).toBe("failed");
    expect((await ei.get("t-retry"))?.status).toBe("failed");
  });

  it("ReplayScheduler queues jobs without mutating tickets", async () => {
    const ei = infra();
    const job = await ei.scheduleReplay({
      manifest_ref: { artifact_id: "m-1", artifact_type: "execution_manifest" },
      attempt_ref: { artifact_id: "a-1", artifact_type: "execution_attempt" },
    });
    expect(job.status).toBe("pending");
    const next = await ei.nextReplay("replay-worker");
    expect(next?.job_id).toBe(job.job_id);
    expect(next?.status).toBe("leased");
  });

  it("AdmittedTicketWorker uses infra retry path", async () => {
    const ei = infra();
    await ei.queue.enqueue(
      createPendingTicket("t-w", {
        artifact_id: "m-ok",
        artifact_type: "execution_manifest",
      }),
    );
    let runs = 0;
    const worker = new AdmittedTicketWorker(
      ei,
      { isAdmitted: async () => true },
      {
        runAdmittedManifest: async () => {
          runs += 1;
          if (runs === 1) throw new Error("transient");
        },
      },
      "w1",
    );
    const first = await worker.processNext();
    expect(first?.status).toBe("pending"); // retried
    const second = await worker.processNext();
    expect(second?.status).toBe("completed");
    expect(runs).toBe(2);
  });
});
