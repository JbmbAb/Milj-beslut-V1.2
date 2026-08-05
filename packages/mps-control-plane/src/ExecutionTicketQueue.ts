import type {
  FrozenExecutionTicket,
  ExecutionTicketStatus,
} from "../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";

/**
 * Durable-oriented ticket queue (Fas 4).
 * In-memory impl for tests; Prisma/Cloud Tasks swap behind same interface.
 */
export interface ExecutionTicketQueue {
  enqueue(ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus }): FrozenExecutionTicket;
  reserve(worker_id: string): FrozenExecutionTicket | null;
  complete(ticket_id: string): void;
  fail(ticket_id: string, reason: string): void;
  retry(ticket_id: string): void;
  get(ticket_id: string): FrozenExecutionTicket | undefined;
}

export class InMemoryExecutionTicketQueue implements ExecutionTicketQueue {
  private readonly tickets = new Map<string, FrozenExecutionTicket>();
  private readonly order: string[] = [];

  enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): FrozenExecutionTicket {
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

  reserve(worker_id: string): FrozenExecutionTicket | null {
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

  complete(ticket_id: string): void {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, { ...t, status: "completed" });
  }

  fail(ticket_id: string, _reason: string): void {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, { ...t, status: "failed" });
  }

  retry(ticket_id: string): void {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    this.tickets.set(ticket_id, {
      ...t,
      status: "pending",
      lease_ref: null,
      attempt_ref: t.attempt_ref,
    });
  }

  get(ticket_id: string): FrozenExecutionTicket | undefined {
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
