import type { LeaseDecision, InfrastructureClock } from "./types.js";

export type LeaseRecord = {
  readonly ticket_id: string;
  readonly worker_id: string;
  readonly leased_at: string;
  readonly lease_ref: string;
};

/**
 * Pure lease timeout decisions — no I/O.
 * Queues apply reclaim; LeaseManager decides.
 */
export class LeaseManager {
  constructor(
    private readonly leaseTimeoutMs: number,
    private readonly clock: InfrastructureClock = { now: () => new Date() },
  ) {}

  issue(ticket_id: string, worker_id: string): LeaseRecord {
    return {
      ticket_id,
      worker_id,
      leased_at: this.clock.now().toISOString(),
      lease_ref: `lease-${worker_id}-${ticket_id}`,
    };
  }

  decide(leased_at_iso: string | null | undefined): LeaseDecision {
    if (!leased_at_iso) {
      return { action: "reclaim", reason: "lease_timeout" };
    }
    const leasedAt = Date.parse(leased_at_iso);
    if (!Number.isFinite(leasedAt)) {
      return { action: "reclaim", reason: "lease_timeout" };
    }
    const age = this.clock.now().getTime() - leasedAt;
    if (age >= this.leaseTimeoutMs) {
      return { action: "reclaim", reason: "lease_timeout" };
    }
    return { action: "hold" };
  }

  get timeoutMs(): number {
    return this.leaseTimeoutMs;
  }
}
