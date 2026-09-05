import type { AgentHandoff, MultiAgentState, MultiAgentUnitState } from "./types";
import { applyVerifiedHandoff } from "./StateMachine";
import { AppendOnlyEventLog, handoffPayload, unitStatePayload } from "./EventLog";

export class DuplicateHandoffConflictError extends Error {}

export interface HandoffIngestResult {
  readonly state: MultiAgentUnitState;
  readonly duplicate: boolean;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class HandoffIngestor {
  private readonly accepted = new Map<string, string>();

  constructor(private readonly eventLog: AppendOnlyEventLog) {}

  ingest(
    current: MultiAgentUnitState,
    handoff: AgentHandoff,
    nextState: MultiAgentState,
    occurredAt = new Date().toISOString(),
  ): HandoffIngestResult {
    const fingerprint = stable({ handoff, nextState });
    const previous = this.accepted.get(handoff.agentRunId);
    if (previous) {
      if (previous !== fingerprint) {
        this.eventLog.append(
          current.unitId,
          "HANDOFF_REJECTED",
          { reason: "agent_run_id_reused_with_different_payload", agentRunId: handoff.agentRunId },
          occurredAt,
        );
        throw new DuplicateHandoffConflictError(
          `agent run ${handoff.agentRunId} was already accepted with different content`,
        );
      }
      return { state: current, duplicate: true };
    }

    let next: MultiAgentUnitState;
    try {
      next = applyVerifiedHandoff(current, handoff, nextState);
    } catch (error) {
      this.eventLog.append(
        current.unitId,
        "HANDOFF_REJECTED",
        {
          agentRunId: handoff.agentRunId,
          handoff: handoffPayload(handoff),
          reason: error instanceof Error ? error.message : "unknown rejection",
        },
        occurredAt,
      );
      throw error;
    }

    this.accepted.set(handoff.agentRunId, fingerprint);
    this.eventLog.append(
      current.unitId,
      "HANDOFF_ACCEPTED",
      { handoff: handoffPayload(handoff), nextState },
      occurredAt,
    );
    this.eventLog.append(
      current.unitId,
      "UNIT_STATE_TRANSITIONED",
      { from: current.state, to: next.state, state: unitStatePayload(next) },
      occurredAt,
    );
    return { state: next, duplicate: false };
  }
}
