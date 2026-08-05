import type { PrismaClient, ExecutionTicketStatus as DbStatus } from "@prisma/client";
import type {
  FrozenExecutionTicket,
  ExecutionTicketStatus,
} from "../../packages/mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ExecutionTicketQueue } from "../../packages/mps-control-plane/src/ExecutionTicketQueue.js";

function toFrozenStatus(status: DbStatus): ExecutionTicketStatus {
  switch (status) {
    case "PENDING":
      return "pending";
    case "LEASED":
      return "leased";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function toDbStatus(status: ExecutionTicketStatus): DbStatus {
  switch (status) {
    case "pending":
    case "retry":
      return "PENDING";
    case "leased":
    case "running":
      return "LEASED";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

type TicketRow = {
  id: string;
  status: DbStatus;
  manifestId: string;
  manifestType: string;
  attemptRef: string | null;
  leaseRef: string | null;
};

function toFrozen(row: TicketRow): FrozenExecutionTicket {
  return {
    ticket_id: row.id,
    manifest_ref: {
      artifact_id: row.manifestId,
      artifact_type: row.manifestType,
    },
    attempt_ref: row.attemptRef,
    lease_ref: row.leaseRef,
    status: toFrozenStatus(row.status),
  };
}

export type PrismaExecutionTicketQueueOptions = {
  readonly leaseTimeoutMs?: number;
  readonly now?: () => Date;
};

/**
 * Prisma-backed ExecutionTicket queue — survives process restart.
 * Lease timeout reclaims abandoned LEASED rows on the next reserve.
 */
export class PrismaExecutionTicketQueue implements ExecutionTicketQueue {
  private readonly leaseTimeoutMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly db: PrismaClient,
    options: PrismaExecutionTicketQueueOptions = {},
  ) {
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? 5 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): Promise<FrozenExecutionTicket> {
    const existing = await this.db.executionTicket.findUnique({
      where: { id: ticket.ticket_id },
    });
    if (existing) {
      if (existing.manifestId !== ticket.manifest_ref.artifact_id) {
        throw new Error(
          `Duplicate ticket_id '${ticket.ticket_id}' with different manifest`,
        );
      }
      return toFrozen(existing);
    }

    const status = toDbStatus(ticket.status ?? "pending");
    const row = await this.db.executionTicket.create({
      data: {
        id: ticket.ticket_id,
        status,
        manifestId: ticket.manifest_ref.artifact_id,
        manifestType: ticket.manifest_ref.artifact_type,
        attemptRef: ticket.attempt_ref,
        leaseRef: ticket.lease_ref,
      },
    });
    return toFrozen(row);
  }

  async reserve(worker_id: string): Promise<FrozenExecutionTicket | null> {
    const cutoff = new Date(this.now().getTime() - this.leaseTimeoutMs);

    return this.db.$transaction(async (tx) => {
      await tx.executionTicket.updateMany({
        where: {
          status: "LEASED",
          leasedAt: { lte: cutoff },
        },
        data: {
          status: "PENDING",
          leaseRef: null,
          leasedAt: null,
        },
      });

      const pending = await tx.executionTicket.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (!pending) return null;

      const leaseRef = `lease-${worker_id}-${pending.id}`;
      const row = await tx.executionTicket.update({
        where: { id: pending.id },
        data: {
          status: "LEASED",
          leaseRef,
          leasedAt: this.now(),
        },
      });
      return toFrozen(row);
    });
  }

  async complete(ticket_id: string): Promise<void> {
    await this.db.executionTicket.updateMany({
      where: { id: ticket_id },
      data: {
        status: "COMPLETED",
        completedAt: this.now(),
        failReason: null,
        leasedAt: null,
      },
    });
  }

  async fail(ticket_id: string, reason: string): Promise<void> {
    await this.db.executionTicket.updateMany({
      where: { id: ticket_id },
      data: {
        status: "FAILED",
        failReason: reason,
        completedAt: this.now(),
        leasedAt: null,
      },
    });
  }

  async retry(ticket_id: string): Promise<void> {
    await this.db.executionTicket.updateMany({
      where: { id: ticket_id },
      data: {
        status: "PENDING",
        leaseRef: null,
        failReason: null,
        leasedAt: null,
        completedAt: null,
      },
    });
  }

  async get(ticket_id: string): Promise<FrozenExecutionTicket | undefined> {
    const row = await this.db.executionTicket.findUnique({ where: { id: ticket_id } });
    return row ? toFrozen(row) : undefined;
  }

  async list(status?: ExecutionTicketStatus): Promise<FrozenExecutionTicket[]> {
    const rows = await this.db.executionTicket.findMany({
      where: status ? { status: toDbStatus(status) } : undefined,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toFrozen);
  }

  async reclaimExpiredLeases(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - this.leaseTimeoutMs);
    const result = await this.db.executionTicket.updateMany({
      where: {
        status: "LEASED",
        leasedAt: { lte: cutoff },
      },
      data: {
        status: "PENDING",
        leaseRef: null,
        leasedAt: null,
      },
    });
    return result.count;
  }
}
