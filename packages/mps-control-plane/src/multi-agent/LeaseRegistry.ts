import type { AgentLease } from "./types";

export class LeaseConflictError extends Error {}

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((path) => b.includes(path));
}

function parseTime(value: string, label: string): number {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new LeaseConflictError(`${label} must be a valid timestamp`);
  return parsed;
}

export class InMemoryLeaseRegistry {
  private readonly leases = new Map<string, AgentLease>();

  acquire(lease: AgentLease, now = new Date()): void {
    this.expireStale(now);
    if (lease.status !== "ACTIVE") throw new LeaseConflictError("new lease must be ACTIVE");
    if (parseTime(lease.expiresAt, "expiresAt") <= now.getTime()) {
      throw new LeaseConflictError("cannot acquire an already-expired lease");
    }

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

  heartbeat(
    leaseId: string,
    holder: string,
    heartbeatAt: string,
    expiresAt: string,
    now = new Date(),
  ): AgentLease {
    this.expireStale(now);
    const lease = this.leases.get(leaseId);
    if (!lease || lease.status !== "ACTIVE") {
      throw new LeaseConflictError(`cannot heartbeat inactive lease ${leaseId}`);
    }
    if (lease.holder !== holder) throw new LeaseConflictError(`lease ${leaseId} is held by another agent`);

    const oldHeartbeat = parseTime(lease.heartbeatAt, "existing heartbeatAt");
    const nextHeartbeat = parseTime(heartbeatAt, "heartbeatAt");
    const nextExpiry = parseTime(expiresAt, "expiresAt");
    if (nextHeartbeat <= oldHeartbeat) {
      throw new LeaseConflictError("heartbeatAt must move forward monotonically");
    }
    if (nextHeartbeat > now.getTime() + 30_000) {
      throw new LeaseConflictError("heartbeatAt is implausibly in the future");
    }
    if (nextExpiry <= nextHeartbeat) {
      throw new LeaseConflictError("expiresAt must be after heartbeatAt");
    }

    const updated = { ...lease, heartbeatAt, expiresAt };
    this.leases.set(leaseId, updated);
    return updated;
  }

  activeFor(unitId: string, now = new Date()): AgentLease[] {
    this.expireStale(now);
    return [...this.leases.values()].filter(
      (lease) => lease.unitId === unitId && lease.status === "ACTIVE",
    );
  }

  get(leaseId: string): AgentLease | undefined {
    return this.leases.get(leaseId);
  }

  expireStale(now = new Date()): AgentLease[] {
    const expired: AgentLease[] = [];
    const nowMs = now.getTime();
    for (const [id, lease] of this.leases.entries()) {
      if (lease.status !== "ACTIVE") continue;
      if (parseTime(lease.expiresAt, "expiresAt") <= nowMs) {
        const next = { ...lease, status: "EXPIRED" as const };
        this.leases.set(id, next);
        expired.push(next);
      }
    }
    return expired;
  }
}
