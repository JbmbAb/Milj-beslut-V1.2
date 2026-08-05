import { describe, it, expect } from "vitest";
import { resolveExecutionTicketQueue } from "../resolve-execution-ticket-queue.js";
import {
  InMemoryExecutionTicketQueue,
  createPendingTicket,
} from "../../../packages/mps-control-plane/src/ExecutionTicketQueue.js";

describe("resolveExecutionTicketQueue feature flags", () => {
  it("uses file backend when LU_MPS_TICKETS=file", async () => {
    const fileQueue = new InMemoryExecutionTicketQueue();
    const { backend, queue } = await resolveExecutionTicketQueue({
      env: { LU_MPS_TICKETS: "file" } as NodeJS.ProcessEnv,
      createFileQueue: () => fileQueue,
      createPrismaQueue: async () => {
        throw new Error("should not call prisma");
      },
    });
    expect(backend).toBe("file");
    await queue.enqueue(
      createPendingTicket("t1", {
        artifact_id: "m1",
        artifact_type: "execution_manifest",
      }),
    );
    expect((await queue.get("t1"))?.status).toBe("pending");
  });

  it("uses prisma backend by default", async () => {
    const prismaQueue = new InMemoryExecutionTicketQueue();
    const { backend } = await resolveExecutionTicketQueue({
      env: {} as NodeJS.ProcessEnv,
      createPrismaQueue: async () => prismaQueue,
      createFileQueue: () => {
        throw new Error("should not fall back");
      },
    });
    expect(backend).toBe("prisma");
  });

  it("falls back to file when prisma factory fails", async () => {
    const fileQueue = new InMemoryExecutionTicketQueue();
    const { backend } = await resolveExecutionTicketQueue({
      env: { LU_MPS_TICKETS: "prisma" } as NodeJS.ProcessEnv,
      createPrismaQueue: async () => {
        throw new Error("db down");
      },
      createFileQueue: () => fileQueue,
    });
    expect(backend).toBe("file");
  });
});
