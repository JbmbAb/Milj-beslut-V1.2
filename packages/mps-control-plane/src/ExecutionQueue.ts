import type {
  ExecutionQueue,
  ExecutionQueueItem,
  WorkerIdentity,
  Lease,
  LeaseState,
  LeaseEventArtifactBase,
  LeaseIssuedArtifact,
  LeaseReleasedArtifact,
  LeaseExpiredArtifact,
  LeaseHeartbeatArtifact,
  LeaseExtendedArtifact,
} from "./types";
import { CanonicalSerializer } from "@miljobeslut/mps-canonical";
import * as crypto from "node:crypto";

export class DefaultExecutionQueue implements ExecutionQueue {
  private queue: ExecutionQueueItem[] = [];
  private leases = new Map<string, LeaseState>();
  private leaseEvents: any[] = [];

  constructor(
    private readonly serializer: CanonicalSerializer,
    private readonly clock: { now(): Date },
    private readonly idGen: { generate(): string }
  ) {}

  enqueue(item: ExecutionQueueItem): void {
    this.queue.push(item);
  }

  // Contract: Fairness + determinism.
  // If two items have identical priority, tenant weight and scheduled_at,
  // queue MUST select lexicographically smallest plan_hash.
  reserve(worker: WorkerIdentity): Lease | null {
    if (this.queue.length === 0) return null;

    // Sortera efter prioritet (HIGH > NORMAL > LOW), sen efter scheduled_at, sen lexikografiskt på plan_hash
    const priorityOrder = { HIGH: 3, NORMAL: 2, LOW: 1 };

    this.queue.sort((a, b) => {
      const pA = priorityOrder[a.priority];
      const pB = priorityOrder[b.priority];

      if (pA !== pB) return pB - pA; // Högst prioritet först

      const timeA = new Date(a.scheduled_at.iso8601).getTime();
      const timeB = new Date(b.scheduled_at.iso8601).getTime();

      if (timeA !== timeB) return timeA - timeB; // Äldsta först

      return a.plan_hash.localeCompare(b.plan_hash); // Lexikografiskt minsta plan_hash
    });

    const item = this.queue.shift()!;
    const lease_id = `lease-${this.idGen.generate()}`;
    const issued_at = { iso8601: this.clock.now().toISOString() };
    const expires_at = { iso8601: new Date(this.clock.now().getTime() + 30000).toISOString() }; // 30s standard

    const leaseState: LeaseState = {
      lease_id,
      queue_item_id: item.queue_item_id,
      worker_id: worker.worker_id,
      issued_at,
      expires_at,
    };

    this.leases.set(lease_id, leaseState);

    const baseEvent = {
      lease_id,
      queue_item_id: item.queue_item_id,
      worker_id: worker.worker_id,
    };

    const eventCore = {
      ...baseEvent,
      schema_version: "lease.issued.v1" as const,
      issued_at,
      expires_at,
    };

    const bytes = this.serializer.serializeCanonical(eventCore, "JSON");
    const lease_event_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    const eventArtifact: LeaseIssuedArtifact = {
      ...eventCore,
      lease_event_hash,
    };

    this.leaseEvents.push(eventArtifact);

    return {
      lease_id,
      item,
      expires_at,
    };
  }

  ack(worker: WorkerIdentity, lease_id: string): void {
    const lease = this.leases.get(lease_id);
    if (!lease || lease.worker_id !== worker.worker_id) {
      throw new Error("Invalid lease or unauthorized worker");
    }

    this.leases.delete(lease_id);

    const baseEvent = {
      lease_id,
      queue_item_id: lease.queue_item_id,
      worker_id: worker.worker_id,
    };

    const eventCore = {
      ...baseEvent,
      schema_version: "lease.released.v1" as const,
      released_at: { iso8601: this.clock.now().toISOString() },
    };

    const bytes = this.serializer.serializeCanonical(eventCore, "JSON");
    const lease_event_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    const eventArtifact: LeaseReleasedArtifact = {
      ...eventCore,
      lease_event_hash,
    };

    this.leaseEvents.push(eventArtifact);
  }

  release(worker: WorkerIdentity, lease_id: string): void {
    this.ack(worker, lease_id); // Släpp arrendet och ta bort det
  }

  fail(worker: WorkerIdentity, lease_id: string, _reason: string): void {
    const lease = this.leases.get(lease_id);
    if (lease && lease.worker_id === worker.worker_id) {
      this.leases.delete(lease_id);
    }
  }

  retry(queue_item_id: string): void {
    // Sätt tillbaka i kön för omkörning
  }

  heartbeat(worker: WorkerIdentity, lease_id: string): void {
    const lease = this.leases.get(lease_id);
    if (!lease || lease.worker_id !== worker.worker_id) {
      throw new Error("Invalid lease or unauthorized worker");
    }

    const baseEvent = {
      lease_id,
      queue_item_id: lease.queue_item_id,
      worker_id: worker.worker_id,
    };

    const eventCore = {
      ...baseEvent,
      schema_version: "lease.heartbeat.v1" as const,
      heartbeat_at: { iso8601: this.clock.now().toISOString() },
    };

    const bytes = this.serializer.serializeCanonical(eventCore, "JSON");
    const lease_event_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    const eventArtifact: LeaseHeartbeatArtifact = {
      ...eventCore,
      lease_event_hash,
    };

    this.leaseEvents.push(eventArtifact);
  }

  extendLease(worker: WorkerIdentity, lease_id: string, duration_ms: number): void {
    const lease = this.leases.get(lease_id);
    if (!lease || lease.worker_id !== worker.worker_id) {
      throw new Error("Invalid lease or unauthorized worker");
    }

    const previous_expires_at = lease.expires_at;
    const newExpiresTime = new Date(previous_expires_at.iso8601).getTime() + duration_ms;
    const new_expires_at = { iso8601: new Date(newExpiresTime).toISOString() };

    this.leases.set(lease_id, {
      ...lease,
      expires_at: new_expires_at,
    });

    const baseEvent = {
      lease_id,
      queue_item_id: lease.queue_item_id,
      worker_id: worker.worker_id,
    };

    const eventCore = {
      ...baseEvent,
      schema_version: "lease.extended.v1" as const,
      previous_expires_at,
      new_expires_at,
    };

    const bytes = this.serializer.serializeCanonical(eventCore, "JSON");
    const lease_event_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    const eventArtifact: LeaseExtendedArtifact = {
      ...eventCore,
      lease_event_hash,
    };

    this.leaseEvents.push(eventArtifact);
  }

  getLeases(): LeaseState[] {
    return Array.from(this.leases.values());
  }

  getLeaseEvents(): any[] {
    return this.leaseEvents;
  }
}
