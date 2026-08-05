import { describe, it, expect, beforeEach } from "vitest";
import { PrismaExecutionTicketQueue } from "../PrismaExecutionTicketQueue.js";
import { createPendingTicket } from "../../../packages/mps-control-plane/src/ExecutionTicketQueue.js";

type Row = {
  id: string;
  status: "PENDING" | "LEASED" | "COMPLETED" | "FAILED";
  manifestId: string;
  manifestType: string;
  attemptRef: string | null;
  leaseRef: string | null;
  failReason: string | null;
  leasedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createMemoryPrisma() {
  const rows = new Map<string, Row>();
  let nowMs = Date.parse("2026-08-05T12:00:00.000Z");

  const api = {
    now: () => new Date(nowMs),
    advance(ms: number) {
      nowMs += ms;
    },
    executionTicket: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.get(where.id) ?? null,
      create: async ({ data }: { data: Partial<Row> & { id: string } }) => {
        const row: Row = {
          id: data.id,
          status: (data.status as Row["status"]) ?? "PENDING",
          manifestId: data.manifestId!,
          manifestType: data.manifestType ?? "execution_manifest",
          attemptRef: data.attemptRef ?? null,
          leaseRef: data.leaseRef ?? null,
          failReason: null,
          leasedAt: null,
          completedAt: null,
          createdAt: new Date(nowMs),
          updatedAt: new Date(nowMs),
        };
        rows.set(row.id, row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (where.id && row.id !== where.id) continue;
          if (where.status && row.status !== where.status) continue;
          if (
            where.leasedAt &&
            typeof where.leasedAt === "object" &&
            where.leasedAt !== null &&
            "lte" in (where.leasedAt as object)
          ) {
            const lte = (where.leasedAt as { lte: Date }).lte;
            if (!row.leasedAt || row.leasedAt.getTime() > lte.getTime()) continue;
          }
          Object.assign(row, data, { updatedAt: new Date(nowMs) });
          count += 1;
        }
        return { count };
      },
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { status: string };
        orderBy: { createdAt: "asc" | "desc" };
      }) => {
        const list = [...rows.values()]
          .filter((r) => r.status === where.status)
          .sort((a, b) =>
            orderBy.createdAt === "asc"
              ? a.createdAt.getTime() - b.createdAt.getTime()
              : b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return list[0] ?? null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Row>;
      }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error("missing");
        Object.assign(row, data, { updatedAt: new Date(nowMs) });
        return row;
      },
    },
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>): Promise<T> {
      return fn(api);
    },
  };

  return api;
}

describe("PrismaExecutionTicketQueue adversarial", () => {
  let db: ReturnType<typeof createMemoryPrisma>;
  let q: PrismaExecutionTicketQueue;

  beforeEach(() => {
    db = createMemoryPrisma();
    q = new PrismaExecutionTicketQueue(db as any, {
      leaseTimeoutMs: 1000,
      now: () => db.now(),
    });
  });

  it("duplicate enqueue is idempotent and does not rewind completed", async () => {
    const ticket = createPendingTicket("p-dup", {
      artifact_id: "m-1",
      artifact_type: "execution_manifest",
    });
    await q.enqueue(ticket);
    await q.reserve("w1");
    await q.complete("p-dup");
    const again = await q.enqueue(ticket);
    expect(again.status).toBe("completed");
  });

  it("lease timeout reclaims abandoned leased tickets", async () => {
    await q.enqueue(
      createPendingTicket("p-lease", {
        artifact_id: "m-lease",
        artifact_type: "execution_manifest",
      }),
    );
    await q.reserve("dead");
    db.advance(1001);
    const recovered = await q.reserve("alive");
    expect(recovered?.ticket_id).toBe("p-lease");
    expect(recovered?.lease_ref).toContain("alive");
  });

  it("idempotent dequeue while leased", async () => {
    await q.enqueue(
      createPendingTicket("p-once", {
        artifact_id: "m-once",
        artifact_type: "execution_manifest",
      }),
    );
    expect(await q.reserve("w1")).not.toBeNull();
    expect(await q.reserve("w2")).toBeNull();
  });

  it("survives simulated crash: leased row remains until timeout then recovers", async () => {
    await q.enqueue(
      createPendingTicket("p-crash", {
        artifact_id: "m-crash",
        artifact_type: "execution_manifest",
      }),
    );
    await q.reserve("w-crash");
    // New queue instance sharing same store
    const q2 = new PrismaExecutionTicketQueue(db as any, {
      leaseTimeoutMs: 1000,
      now: () => db.now(),
    });
    expect(await q2.reserve("w-other")).toBeNull();
    db.advance(1001);
    expect((await q2.reserve("w-recover"))?.ticket_id).toBe("p-crash");
  });
});
