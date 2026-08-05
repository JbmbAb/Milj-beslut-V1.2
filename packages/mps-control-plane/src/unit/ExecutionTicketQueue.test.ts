import { describe, it, expect } from "vitest";
import {
  InMemoryExecutionTicketQueue,
  createPendingTicket,
} from "../ExecutionTicketQueue.js";

describe("ExecutionTicketQueue", () => {
  it("reserves pending tickets with lease_ref and supports retry", () => {
    const q = new InMemoryExecutionTicketQueue();
    q.enqueue(
      createPendingTicket("t1", {
        artifact_id: "m-1",
        artifact_type: "execution_manifest",
      }),
    );

    const leased = q.reserve("worker-a");
    expect(leased?.status).toBe("leased");
    expect(leased?.lease_ref).toContain("worker-a");

    q.fail("t1", "boom");
    expect(q.get("t1")?.status).toBe("failed");

    q.retry("t1");
    expect(q.get("t1")?.status).toBe("pending");
    expect(q.get("t1")?.lease_ref).toBeNull();
  });
});
