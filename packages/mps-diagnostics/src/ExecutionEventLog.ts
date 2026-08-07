/**
 * Package 22.1 — ExecutionEventLog
 * Immutable append-only governance evidence stream (ADR-MPS-022).
 *
 * P21 MUST NEVER read this log to produce replay results.
 * This log MUST NEVER modify P21 identity.
 */

import {
  createExecutionEvent,
  type ExecutionEvent,
  type ExecutionEventInput,
  verifyExecutionEventIntegrity,
} from "./ExecutionEvent.js";
import {
  assertBlockedFailureArtifactRequired,
  FailureArtifactError,
  failureRefAsOutputArtifact,
  type FailureArtifactReference,
} from "./FailureArtifact.js";
import type {
  DiagnosticArtifactReference,
  DiagnosticContentReference,
  ExecutionStage,
  HarvestExecutionState,
  Timestamp,
} from "./types.js";

export class ExecutionEventLogError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionEventLogError";
  }
}

export type AppendTransitionInput = {
  readonly execution_id: string;
  readonly from_state: HarvestExecutionState;
  readonly to_state: HarvestExecutionState;
  readonly stage: ExecutionStage;
  readonly input_refs?: readonly DiagnosticContentReference[];
  readonly output_refs?: readonly DiagnosticArtifactReference[];
  /**
   * F22-5: REQUIRED when to_state is BLOCKED.
   * Bound into output_refs so evidence enters transition_hash (diagnostic track only).
   */
  readonly failure_artifact_ref?: FailureArtifactReference;
  readonly occurred_at: Timestamp;
  readonly actor: string;
  readonly runtime_version?: string;
  readonly request_id?: string;
};

export interface ExecutionEventLog {
  append(transition: AppendTransitionInput): ExecutionEvent;
  list(execution_id: string): readonly ExecutionEvent[];
  get(execution_id: string, sequence: number): ExecutionEvent | undefined;
  verifyChain(execution_id: string): boolean;
}

/**
 * In-memory append-only log for 22.1.
 * Committed events cannot be mutated or deleted.
 */
export class InMemoryExecutionEventLog implements ExecutionEventLog {
  private readonly byExecution = new Map<string, ExecutionEvent[]>();

  append(transition: AppendTransitionInput): ExecutionEvent {
    // F22-5 — Diagnostic Governance only (never ReplayEngine).
    try {
      assertBlockedFailureArtifactRequired(
        transition.to_state,
        transition.failure_artifact_ref,
      );
    } catch (err) {
      if (err instanceof FailureArtifactError) {
        throw new ExecutionEventLogError(err.code, err.message);
      }
      throw err;
    }

    const existing = this.byExecution.get(transition.execution_id) ?? [];
    const sequence = existing.length + 1;
    const previous = existing[existing.length - 1];

    if (sequence > 1 && previous) {
      if (previous.to_state !== transition.from_state) {
        throw new ExecutionEventLogError(
          "MPS-DIAG-EVENT-STATE-GAP",
          `from_state ${transition.from_state} does not continue previous to_state ${previous.to_state}`,
        );
      }
    }

    const output_refs: DiagnosticArtifactReference[] = [
      ...(transition.output_refs ?? []),
    ];
    if (transition.failure_artifact_ref) {
      output_refs.push(failureRefAsOutputArtifact(transition.failure_artifact_ref));
    }

    const input: ExecutionEventInput = {
      execution_id: transition.execution_id,
      sequence,
      from_state: transition.from_state,
      to_state: transition.to_state,
      stage: transition.stage,
      input_refs: transition.input_refs,
      output_refs,
      previous_event_hash: previous?.transition_hash,
      occurred_at: transition.occurred_at,
      actor: transition.actor,
      runtime_version: transition.runtime_version,
      request_id: transition.request_id,
    };

    const event = createExecutionEvent(input);

    // Freeze storage: store a deep-frozen copy so callers cannot mutate committed evidence.
    const committed = Object.freeze({
      ...event,
      input_refs: Object.freeze([...event.input_refs]),
      output_refs: Object.freeze([...event.output_refs]),
    }) as ExecutionEvent;

    const next = Object.freeze([...existing, committed]) as ExecutionEvent[];
    this.byExecution.set(transition.execution_id, next);
    return committed;
  }

  list(execution_id: string): readonly ExecutionEvent[] {
    return this.byExecution.get(execution_id) ?? [];
  }

  get(execution_id: string, sequence: number): ExecutionEvent | undefined {
    return this.list(execution_id).find((e) => e.sequence === sequence);
  }

  /**
   * Verifies monotonic sequence, previous_event_hash chain, and transition_hash integrity.
   * Ordering by occurred_at is intentionally NOT used (P22-C2).
   */
  verifyChain(execution_id: string): boolean {
    const events = this.list(execution_id);
    if (events.length === 0) return true;

    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      if (event.sequence !== i + 1) return false;
      if (!verifyExecutionEventIntegrity(event)) return false;

      if (i === 0) {
        if (event.previous_event_hash !== undefined) return false;
      } else {
        const prev = events[i - 1]!;
        if (event.previous_event_hash !== prev.transition_hash) return false;
        if (event.from_state !== prev.to_state) return false;
      }
    }
    return true;
  }
}
