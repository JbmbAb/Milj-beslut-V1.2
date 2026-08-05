import type {
  FrozenExecutionTicket,
  ExecutionTicketStatus,
} from "../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";

/**
 * Durable-oriented ticket queue (Fas 4).
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
}

export class InMemoryExecutionTicketQueue implements ExecutionTicketQueue {
  private readonly tickets = new Map<string, FrozenExecutionTicket>();
  private readonly order: string[] = [];

  async enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): Promise<FrozenExecutionTicket> {
    const full: FrozenExecutionTicket = {
      ticket_id: ticket.ticket_id,
      manifest_ref: ticket.manifest_ref,
      attempt_ref: ticket.attempt_ref,
      lease_ref: ticket.lease_ref,
      status: ticket.status ?? "pending",
    };
    this.tickets.set(full.ticket_id, full);
    this.order.push(full.ticket_id);
    return full;
  }

  async reserve(worker_id: string): Promise<FrozenExecutionTicket | null> {
    for (const id of this.order) {
      const t = this.tickets.get(id);
      if (t && t.status === "pending") {
        const leased: FrozenExecutionTicket = {
          ...t,
          status: "leased",
          lease_ref: `lease-${worker_id}-${id}`,
        };
        this.tickets.set(id, leased);
        return leased;
      }
    }
    return null;
  }

  async complete(ticket_id: string): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, { ...t, status: "completed" });
  }

  async fail(ticket_id: string, _reason: string): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, { ...t, status: "failed" });
  }

  async retry(ticket_id: string): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, {
      ...t,
      status: "pending",
      lease_ref: null,
      attempt_ref: t.attempt_ref,
    });
  }

  async get(ticket_id: string): Promise<FrozenExecutionTicket | undefined> {
    return this.tickets.get(ticket_id);
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
