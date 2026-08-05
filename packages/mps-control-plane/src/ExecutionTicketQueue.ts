import type {
  FrozenExecutionTicket,
  ExecutionTicketStatus,
} from "../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";

/**
 * Durable-oriented ticket queue (Execution Platform 2.1).
 * Async so Prisma / Cloud Tasks can persist without sync wrappers.
 */
export interface ExecutionTicketQueue {
  enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): Promise<FrozenExecutionTicket>;
  reserve(worker_id: string): Promise<FrozenExecutionTicket | null>;
  complete(ticket_id: string): Promise<void>;
  fail(ticket_id: string, reason: string): Promise<void>;
  retry(ticket_id: string): Promise<void>;
  get(ticket_id: string): Promise<FrozenExecutionTicket | undefined>;
  /** List tickets by status (crash recovery / ops). */
  list?(status?: ExecutionTicketStatus): Promise<FrozenExecutionTicket[]>;
  /** Reclaim expired leases → pending. Returns count reclaimed. */
  reclaimExpiredLeases?(): Promise<number>;
}

type MemoryRecord = FrozenExecutionTicket & { leased_at?: string | null };

export class InMemoryExecutionTicketQueue implements ExecutionTicketQueue {
  private readonly tickets = new Map<string, MemoryRecord>();
  private readonly order: string[] = [];
  private readonly leaseTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options?: { leaseTimeoutMs?: number; now?: () => Date }) {
    this.leaseTimeoutMs = options?.leaseTimeoutMs ?? 5 * 60 * 1000;
    this.now = options?.now ?? (() => new Date());
  }

  async enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): Promise<FrozenExecutionTicket> {
    const existing = this.tickets.get(ticket.ticket_id);
    if (existing) {
      if (existing.manifest_ref.artifact_id !== ticket.manifest_ref.artifact_id) {
        throw new Error(
          `Duplicate ticket_id '${ticket.ticket_id}' with different manifest`,
        );
      }
      return existing;
    }
    const full: MemoryRecord = {
      ticket_id: ticket.ticket_id,
      manifest_ref: ticket.manifest_ref,
      attempt_ref: ticket.attempt_ref ?? null,
      lease_ref: ticket.lease_ref ?? null,
      status: ticket.status ?? "pending",
      leased_at: null,
    };
    this.tickets.set(full.ticket_id, full);
    this.order.push(full.ticket_id);
    return full;
  }

  async reclaimExpiredLeases(): Promise<number> {
    const cutoff = this.now().getTime() - this.leaseTimeoutMs;
    let n = 0;
    for (const id of this.order) {
      const t = this.tickets.get(id);
      if (!t || t.status !== "leased" || !t.leased_at) continue;
      const leasedAt = Date.parse(t.leased_at);
      if (Number.isFinite(leasedAt) && leasedAt <= cutoff) {
        this.tickets.set(id, {
          ...t,
          status: "pending",
          lease_ref: null,
          leased_at: null,
        });
        n += 1;
      }
    }
    return n;
  }

  async reserve(worker_id: string): Promise<FrozenExecutionTicket | null> {
    await this.reclaimExpiredLeases();
    for (const id of this.order) {
      const t = this.tickets.get(id);
      if (t && t.status === "pending") {
        const leased: MemoryRecord = {
          ...t,
          status: "leased",
          lease_ref: `lease-${worker_id}-${id}`,
          leased_at: this.now().toISOString(),
        };
        this.tickets.set(id, leased);
        return leased;
      }
    }
    return null;
  }

  async complete(ticket_id: string): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t || t.status === "completed") return;
    this.tickets.set(ticket_id, { ...t, status: "completed", leased_at: null });
  }

  async fail(ticket_id: string, _reason: string): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, { ...t, status: "failed", leased_at: null });
  }

  async retry(ticket_id: string): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, {
      ...t,
      status: "pending",
      lease_ref: null,
      attempt_ref: t.attempt_ref,
      leased_at: null,
    });
  }

  async get(ticket_id: string): Promise<FrozenExecutionTicket | undefined> {
    return this.tickets.get(ticket_id);
  }

  async list(status?: ExecutionTicketStatus): Promise<FrozenExecutionTicket[]> {
    const all = this.order
      .map((id) => this.tickets.get(id))
      .filter((t): t is MemoryRecord => Boolean(t));
    return status ? all.filter((t) => t.status === status) : all;
  }
}

export function createPendingTicket(
  ticket_id: string,
  manifest_ref: ArtifactReference,
): FrozenExecutionTicket {
  return {
    ticket_id,
    manifest_ref,
    attempt_ref: null,
    lease_ref: null,
    status: "pending",
  };
}
