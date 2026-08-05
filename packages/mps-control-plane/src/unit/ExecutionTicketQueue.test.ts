import { describe, it, expect } from "vitest";
import {
  InMemoryExecutionTicketQueue,
  createPendingTicket,
} from "../ExecutionTicketQueue.js";

describe("ExecutionTicketQueue", () => {
  it("reserves pending tickets with lease_ref and supports retry", async () => {
    const q = new InMemoryExecutionTicketQueue();
    await q.enqueue(
      createPendingTicket("t1", {
        artifact_id: "m-1",
        artifact_type: "execution_manifest",
      }),
    );

    const leased = await q.reserve("worker-a");
    expect(leased?.status).toBe("leased");
    expect(leased?.lease_ref).toContain("worker-a");

    await q.fail("t1", "boom");
    expect((await q.get("t1"))?.status).toBe("failed");

    await q.retry("t1");
    expect((await q.get("t1"))?.status).toBe("pending");
    expect((await q.get("t1"))?.lease_ref).toBeNull();
  });
});
