import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileDurableExecutionTicketQueue,
  createPendingTicket,
} from "../FileDurableExecutionTicketQueue.js";
import { AdmittedTicketWorker } from "../AdmittedTicketWorker.js";

describe("Durable ticket queue adversarial (file backend)", () => {
  let dir: string;
  let file: string;
  let nowMs: number;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tickets-adv-"));
    file = path.join(dir, "queue.json");
    nowMs = Date.parse("2026-08-05T12:00:00.000Z");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function queue(leaseTimeoutMs = 1000) {
    return new FileDurableExecutionTicketQueue({
      filePath: file,
      leaseTimeoutMs,
      now: () => new Date(nowMs),
    });
  }

  it("survives restart mid-run (leased ticket still on disk)", async () => {
    const q1 = queue();
    await q1.enqueue(
      createPendingTicket("t-restart", {
        artifact_id: "m-1",
        artifact_type: "execution_manifest",
      }),
    );
    const leased = await q1.reserve("w1");
    expect(leased?.status).toBe("leased");

    // Process crash: new queue instance, lease still held until timeout
    const q2 = queue(60_000);
    expect((await q2.get("t-restart"))?.status).toBe("leased");
    expect(await q2.reserve("w2")).toBeNull();

    // After lease timeout, recoverable
    nowMs += 60_001;
    const q3 = queue(60_000);
    const recovered = await q3.reserve("w3");
    expect(recovered?.ticket_id).toBe("t-restart");
    expect(recovered?.lease_ref).toContain("w3");
  });

  it("reclaims expired leases (lease timeout)", async () => {
    const q = queue(500);
    await q.enqueue(
      createPendingTicket("t-lease", {
        artifact_id: "m-lease",
        artifact_type: "execution_manifest",
      }),
    );
    await q.reserve("worker-a");
    nowMs += 501;
    const again = await q.reserve("worker-b");
    expect(again?.ticket_id).toBe("t-lease");
    expect(again?.lease_ref).toContain("worker-b");
  });

  it("duplicate enqueue is idempotent for same manifest", async () => {
    const q = queue();
    const ticket = createPendingTicket("t-dup", {
      artifact_id: "m-dup",
      artifact_type: "execution_manifest",
    });
    await q.enqueue(ticket);
    await q.reserve("w1");
    await q.complete("t-dup");

    const again = await q.enqueue(ticket);
    expect(again.status).toBe("completed");
    expect((await q.get("t-dup"))?.status).toBe("completed");
  });

  it("duplicate enqueue with different manifest fails closed", async () => {
    const q = queue();
    await q.enqueue(
      createPendingTicket("t-dup2", {
        artifact_id: "m-a",
        artifact_type: "execution_manifest",
      }),
    );
    await expect(
      q.enqueue(
        createPendingTicket("t-dup2", {
          artifact_id: "m-b",
          artifact_type: "execution_manifest",
        }),
      ),
    ).rejects.toThrow(/different manifest/);
  });

  it("idempotent dequeue: second reserve returns null while leased", async () => {
    const q = queue(60_000);
    await q.enqueue(
      createPendingTicket("t-once", {
        artifact_id: "m-once",
        artifact_type: "execution_manifest",
      }),
    );
    expect(await q.reserve("w1")).not.toBeNull();
    expect(await q.reserve("w2")).toBeNull();
  });

  it("recovery after process crash via worker + expired lease", async () => {
    const q = queue(100);
    await q.enqueue(
      createPendingTicket("t-crash", {
        artifact_id: "m-crash",
        artifact_type: "execution_manifest",
      }),
    );
    await q.reserve("dead-worker");
    nowMs += 101;

    let ran = false;
    const worker = new AdmittedTicketWorker(
      q,
      { isAdmitted: async () => true },
      {
        runAdmittedManifest: async () => {
          ran = true;
        },
      },
      "recovery-worker",
    );
    const result = await worker.processNext();
    expect(ran).toBe(true);
    expect(result?.status).toBe("completed");
  });

  it("complete is idempotent after crash-recovery complete", async () => {
    const q = queue();
    await q.enqueue(
      createPendingTicket("t-idemp", {
        artifact_id: "m-idemp",
        artifact_type: "execution_manifest",
      }),
    );
    await q.reserve("w1");
    await q.complete("t-idemp");
    await q.complete("t-idemp");
    expect((await q.get("t-idemp"))?.status).toBe("completed");
  });
});
