import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileDurableExecutionTicketQueue,
  createPendingTicket,
} from "../FileDurableExecutionTicketQueue.js";
import { AdmittedTicketWorker } from "../AdmittedTicketWorker.js";
import {
  InMemoryExecutionTicketQueue,
} from "../ExecutionTicketQueue.js";

describe("FileDurableExecutionTicketQueue", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tickets-"));
    file = path.join(dir, "queue.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists enqueue/reserve/complete across instances", async () => {
    const q1 = new FileDurableExecutionTicketQueue(file);
    await q1.enqueue(
      createPendingTicket("t-dur-1", {
        artifact_id: "m-1",
        artifact_type: "execution_manifest",
      }),
    );

    const q2 = new FileDurableExecutionTicketQueue(file);
    const leased = await q2.reserve("w1");
    expect(leased?.ticket_id).toBe("t-dur-1");
    expect(leased?.status).toBe("leased");

    await q2.complete("t-dur-1");
    expect((await q2.get("t-dur-1"))?.status).toBe("completed");
  });
});

describe("AdmittedTicketWorker", () => {
  it("fails ticket when manifest is not admitted", async () => {
    const q = new InMemoryExecutionTicketQueue();
    await q.enqueue(
      createPendingTicket("t1", {
        artifact_id: "m-denied",
        artifact_type: "execution_manifest",
      }),
    );

    const worker = new AdmittedTicketWorker(
      q,
      { isAdmitted: async () => false },
      { runAdmittedManifest: async () => undefined },
      "worker-1",
    );

    const result = await worker.processNext();
    expect(result?.status).toBe("failed");
  });

  it("completes ticket when admitted and runner succeeds", async () => {
    const q = new InMemoryExecutionTicketQueue();
    await q.enqueue(
      createPendingTicket("t2", {
        artifact_id: "m-ok",
        artifact_type: "execution_manifest",
      }),
    );

    let ran = false;
    const worker = new AdmittedTicketWorker(
      q,
      { isAdmitted: async (id) => id === "m-ok" },
      {
        runAdmittedManifest: async () => {
          ran = true;
        },
      },
      "worker-1",
    );

    const result = await worker.processNext();
    expect(ran).toBe(true);
    expect(result?.status).toBe("completed");
  });
});
