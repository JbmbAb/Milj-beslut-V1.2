import { createHash } from "node:crypto";

import type { AgentHandoff, AgentLease, MultiAgentUnitState } from "./types";

export type ControlPlaneEventKind =
  | "UNIT_STATE_TRANSITIONED"
  | "HANDOFF_ACCEPTED"
  | "HANDOFF_REJECTED"
  | "LEASE_ACQUIRED"
  | "LEASE_HEARTBEAT"
  | "LEASE_RELEASED"
  | "LEASE_EXPIRED"
  | "ROUTE_DECIDED";

export interface ControlPlaneEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
  readonly occurredAt: string;
  readonly unitId: string;
  readonly kind: ControlPlaneEventKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export class AppendOnlyEventLog {
  private readonly events: ControlPlaneEvent[] = [];

  append(
    unitId: string,
    kind: ControlPlaneEventKind,
    payload: Readonly<Record<string, unknown>>,
    occurredAt = new Date().toISOString(),
  ): ControlPlaneEvent {
    const previous = this.events.at(-1) ?? null;
    const sequence = this.events.length + 1;
    const eventCore = {
      sequence,
      previousEventHash: previous?.eventHash ?? null,
      occurredAt,
      unitId,
      kind,
      payload,
    };
    const eventId = hash({ unitId, kind, payload, occurredAt, sequence });
    const eventHash = hash({ eventId, ...eventCore });
    const event: ControlPlaneEvent = { eventId, eventHash, ...eventCore };
    this.events.push(event);
    return event;
  }

  all(): readonly ControlPlaneEvent[] {
    return [...this.events];
  }

  forUnit(unitId: string): readonly ControlPlaneEvent[] {
    return this.events.filter((event) => event.unitId === unitId);
  }

  verifyChain(): boolean {
    let previous: string | null = null;
    for (const event of this.events) {
      if (event.previousEventHash !== previous) return false;
      const { eventHash, ...withoutHash } = event;
      if (hash(withoutHash) !== eventHash) return false;
      previous = eventHash;
    }
    return true;
  }
}

export function unitStatePayload(state: MultiAgentUnitState): Record<string, unknown> {
  return { ...state };
}

export function handoffPayload(handoff: AgentHandoff): Record<string, unknown> {
  return { ...handoff };
}

export function leasePayload(lease: AgentLease): Record<string, unknown> {
  return { ...lease };
}
