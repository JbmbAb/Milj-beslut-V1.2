import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import type {
  FrozenExecutionTicket,
  ExecutionTicketStatus,
} from "../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import type { ExecutionTicketQueue } from "./ExecutionTicketQueue.js";
import { createPendingTicket } from "./ExecutionTicketQueue.js";

type TicketRecord = FrozenExecutionTicket & { fail_reason?: string };

/**
 * Durable ticket queue persisted as JSON (Fas 4).
 * Swap for Prisma/Cloud Tasks behind ExecutionTicketQueue without changing workers.
 */
export class FileDurableExecutionTicketQueue implements ExecutionTicketQueue {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private readAll(): TicketRecord[] {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) return [];
    return JSON.parse(readFileSync(this.filePath, "utf8")) as TicketRecord[];
  }

  private writeAll(tickets: TicketRecord[]): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(tickets, null, 2), "utf8");
  }

  enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): FrozenExecutionTicket {
    const tickets = this.readAll().filter((t) => t.ticket_id !== ticket.ticket_id);
    const full: TicketRecord = {
      ticket_id: ticket.ticket_id,
      manifest_ref: ticket.manifest_ref,
      attempt_ref: ticket.attempt_ref,
      lease_ref: ticket.lease_ref,
      status: ticket.status ?? "pending",
    };
    tickets.push(full);
    this.writeAll(tickets);
    return full;
  }

  reserve(worker_id: string): FrozenExecutionTicket | null {
    const tickets = this.readAll();
    const idx = tickets.findIndex((t) => t.status === "pending");
    if (idx < 0) return null;
    const leased: TicketRecord = {
      ...tickets[idx],
      status: "leased",
      lease_ref: `lease-${worker_id}-${tickets[idx].ticket_id}`,
    };
    tickets[idx] = leased;
    this.writeAll(tickets);
    return leased;
  }

  complete(ticket_id: string): void {
    this.patch(ticket_id, (t) => ({ ...t, status: "completed" }));
  }

  fail(ticket_id: string, reason: string): void {
    this.patch(ticket_id, (t) => ({ ...t, status: "failed", fail_reason: reason }));
  }

  retry(ticket_id: string): void {
    this.patch(ticket_id, (t) => ({
      ...t,
      status: "pending",
      lease_ref: null,
      fail_reason: undefined,
    }));
  }

  get(ticket_id: string): FrozenExecutionTicket | undefined {
    return this.readAll().find((t) => t.ticket_id === ticket_id);
  }

  private patch(
    ticket_id: string,
    fn: (t: TicketRecord) => TicketRecord,
  ): void {
    const tickets = this.readAll();
    const idx = tickets.findIndex((t) => t.ticket_id === ticket_id);
    if (idx < 0) return;
    tickets[idx] = fn(tickets[idx]);
    this.writeAll(tickets);
  }
}

export function createFileTicketQueue(
  baseDir = ".data/execution-tickets",
): FileDurableExecutionTicketQueue {
  return new FileDurableExecutionTicketQueue(path.join(baseDir, "queue.json"));
}

export { createPendingTicket };
