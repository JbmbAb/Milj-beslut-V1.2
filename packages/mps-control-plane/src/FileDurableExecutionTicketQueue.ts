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

type TicketRecord = FrozenExecutionTicket & {
  fail_reason?: string;
  leased_at?: string | null;
};

export type FileDurableTicketQueueOptions = {
  readonly filePath: string;
  /** Expired leases become pending again on reserve (default 5 min). */
  readonly leaseTimeoutMs?: number;
  /** Injected clock for tests. */
  readonly now?: () => Date;
};

/**
 * File-backed ticket queue (dev / fallback).
 * Prefer PrismaExecutionTicketQueue in production composition roots.
 */
export class FileDurableExecutionTicketQueue implements ExecutionTicketQueue {
  private readonly filePath: string;
  private readonly leaseTimeoutMs: number;
  private readonly now: () => Date;

  constructor(filePathOrOptions: string | FileDurableTicketQueueOptions) {
    if (typeof filePathOrOptions === "string") {
      this.filePath = filePathOrOptions;
      this.leaseTimeoutMs = 5 * 60 * 1000;
      this.now = () => new Date();
    } else {
      this.filePath = filePathOrOptions.filePath;
      this.leaseTimeoutMs = filePathOrOptions.leaseTimeoutMs ?? 5 * 60 * 1000;
      this.now = filePathOrOptions.now ?? (() => new Date());
    }
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

  private reclaimExpired(tickets: TicketRecord[]): boolean {
    const cutoff = this.now().getTime() - this.leaseTimeoutMs;
    let changed = false;
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (t.status !== "leased" || !t.leased_at) continue;
      const leasedAt = Date.parse(t.leased_at);
      if (Number.isFinite(leasedAt) && leasedAt <= cutoff) {
        tickets[i] = {
          ...t,
          status: "pending",
          lease_ref: null,
          leased_at: null,
        };
        changed = true;
      }
    }
    return changed;
  }

  async enqueue(
    ticket: Omit<FrozenExecutionTicket, "status"> & { status?: ExecutionTicketStatus },
  ): Promise<FrozenExecutionTicket> {
    const tickets = this.readAll();
    const existing = tickets.find((t) => t.ticket_id === ticket.ticket_id);
    if (existing) {
      // Duplicate enqueue: idempotent if same manifest; do not rewind completed/failed.
      if (existing.manifest_ref.artifact_id !== ticket.manifest_ref.artifact_id) {
        throw new Error(
          `Duplicate ticket_id '${ticket.ticket_id}' with different manifest`,
        );
      }
      return existing;
    }

    const full: TicketRecord = {
      ticket_id: ticket.ticket_id,
      manifest_ref: ticket.manifest_ref,
      attempt_ref: ticket.attempt_ref ?? null,
      lease_ref: ticket.lease_ref ?? null,
      status: ticket.status ?? "pending",
      leased_at: null,
    };
    tickets.push(full);
    this.writeAll(tickets);
    return full;
  }

  async reserve(worker_id: string): Promise<FrozenExecutionTicket | null> {
    const tickets = this.readAll();
    const reclaimed = this.reclaimExpired(tickets);
    const idx = tickets.findIndex((t) => t.status === "pending");
    if (idx < 0) {
      if (reclaimed) this.writeAll(tickets);
      return null;
    }
    const leased: TicketRecord = {
      ...tickets[idx],
      status: "leased",
      lease_ref: `lease-${worker_id}-${tickets[idx].ticket_id}`,
      leased_at: this.now().toISOString(),
    };
    tickets[idx] = leased;
    this.writeAll(tickets);
    return leased;
  }

  async complete(ticket_id: string): Promise<void> {
    this.patch(ticket_id, (t) => {
      if (t.status === "completed") return t;
      return { ...t, status: "completed", leased_at: null };
    });
  }

  async fail(ticket_id: string, reason: string): Promise<void> {
    this.patch(ticket_id, (t) => {
      if (t.status === "failed" && t.fail_reason === reason) return t;
      return { ...t, status: "failed", fail_reason: reason, leased_at: null };
    });
  }

  async retry(ticket_id: string): Promise<void> {
    this.patch(ticket_id, (t) => ({
      ...t,
      status: "pending",
      lease_ref: null,
      fail_reason: undefined,
      leased_at: null,
    }));
  }

  async get(ticket_id: string): Promise<FrozenExecutionTicket | undefined> {
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
  options?: Omit<FileDurableTicketQueueOptions, "filePath">,
): FileDurableExecutionTicketQueue {
  return new FileDurableExecutionTicketQueue({
    filePath: path.join(baseDir, "queue.json"),
    ...options,
  });
}

export { createPendingTicket };
