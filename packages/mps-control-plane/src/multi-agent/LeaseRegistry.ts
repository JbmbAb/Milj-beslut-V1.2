import type { AgentLease } from "./types";

export class LeaseConflictError extends Error {}

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((path) => b.includes(path));
}

export class InMemoryLeaseRegistry {
  private readonly leases = new Map<string, AgentLease>();

  acquire(lease: AgentLease, now = new Date()): void {
    this.expireStale(now);

    for (const existing of this.leases.values()) {
      if (existing.status !== "ACTIVE") continue;
      if (existing.unitId !== lease.unitId) continue;
      if (existing.role !== lease.role) continue;
      if (!overlaps(existing.scope, lease.scope)) continue;

      throw new LeaseConflictError(
        `active ${lease.role} lease already covers overlapping scope for unit ${lease.unitId}`,
      );
    }

    this.leases.set(lease.leaseId, lease);
  }

  release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.set(leaseId, { ...lease, status: "RELEASED" });
  }

  heartbeat(leaseId: string, heartbeatAt: string, expiresAt: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.status !== "ACTIVE") {
      throw new LeaseConflictError(`cannot heartbeat inactive lease ${leaseId}`);
    }
    this.leases.set(leaseId, { ...lease, heartbeatAt, expiresAt });
  }

  activeFor(unitId: string): AgentLease[] {
    return [...this.leases.values()].filter(
      (lease) => lease.unitId === unitId && lease.status === "ACTIVE",
    );
  }

  expireStale(now = new Date()): void {
    const nowMs = now.getTime();
    for (const [id, lease] of this.leases.entries()) {
      if (lease.status !== "ACTIVE") continue;
      if (new Date(lease.expiresAt).getTime() <= nowMs) {
        this.leases.set(id, { ...lease, status: "EXPIRED" });
      }
    }
  }
}
