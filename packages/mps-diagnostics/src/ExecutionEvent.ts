/**
 * Package 22.1 — ExecutionEvent
 * Governance evidence event (not an application log line).
 * @see ADR-MPS-022 rev 022.1
 */

import { hashCanonical } from "./canonicalHash.js";
import type {
  DiagnosticArtifactReference,
  DiagnosticContentReference,
  ExecutionStage,
  HarvestExecutionState,
  Timestamp,
} from "./types.js";

/** Fields that enter transition_hash / event identity. */
export type ExecutionEventIdentity = {
  /** Deterministic id derived from execution_id + sequence + transition_hash (not a random UUID). */
  readonly event_id: string;
  readonly execution_id: string;
  readonly sequence: number;
  readonly from_state: HarvestExecutionState;
  readonly to_state: HarvestExecutionState;
  readonly stage: ExecutionStage;
  readonly input_refs: readonly DiagnosticContentReference[];
  readonly output_refs: readonly DiagnosticArtifactReference[];
  readonly previous_event_hash?: string;
  readonly transition_hash: string;
};

/** Metadata — MUST NOT enter transition_hash. */
export type ExecutionEventMetadata = {
  readonly occurred_at: Timestamp;
  readonly actor: string;
  readonly runtime_version?: string;
  readonly request_id?: string;
};

export type ExecutionEvent = ExecutionEventIdentity & ExecutionEventMetadata;

export type ExecutionEventInput = {
  readonly execution_id: string;
  readonly sequence: number;
  readonly from_state: HarvestExecutionState;
  readonly to_state: HarvestExecutionState;
  readonly stage: ExecutionStage;
  readonly input_refs?: readonly DiagnosticContentReference[];
  readonly output_refs?: readonly DiagnosticArtifactReference[];
  readonly previous_event_hash?: string;
  readonly occurred_at: Timestamp;
  readonly actor: string;
  readonly runtime_version?: string;
  readonly request_id?: string;
};

/**
 * Identity payload for hashing — excludes transition_hash itself and all metadata.
 */
export function buildTransitionIdentityPayload(
  input: Omit<ExecutionEventInput, "occurred_at" | "actor" | "runtime_version" | "request_id"> & {
    readonly input_refs: readonly DiagnosticContentReference[];
    readonly output_refs: readonly DiagnosticArtifactReference[];
  },
): Record<string, unknown> {
  return {
    execution_id: input.execution_id,
    sequence: input.sequence,
    from_state: input.from_state,
    to_state: input.to_state,
    stage: input.stage,
    input_refs: input.input_refs,
    output_refs: input.output_refs,
    ...(input.previous_event_hash !== undefined
      ? { previous_event_hash: input.previous_event_hash }
      : {}),
  };
}

export function computeTransitionHash(
  input: Omit<ExecutionEventInput, "occurred_at" | "actor" | "runtime_version" | "request_id"> & {
    readonly input_refs: readonly DiagnosticContentReference[];
    readonly output_refs: readonly DiagnosticArtifactReference[];
  },
): string {
  return hashCanonical(buildTransitionIdentityPayload(input));
}

export function createExecutionEvent(input: ExecutionEventInput): ExecutionEvent {
  const input_refs = input.input_refs ?? [];
  const output_refs = input.output_refs ?? [];
  const transition_hash = computeTransitionHash({
    execution_id: input.execution_id,
    sequence: input.sequence,
    from_state: input.from_state,
    to_state: input.to_state,
    stage: input.stage,
    input_refs,
    output_refs,
    previous_event_hash: input.previous_event_hash,
  });

  const event_id = hashCanonical({
    execution_id: input.execution_id,
    sequence: input.sequence,
    transition_hash,
  });

  return {
    event_id,
    execution_id: input.execution_id,
    sequence: input.sequence,
    from_state: input.from_state,
    to_state: input.to_state,
    stage: input.stage,
    input_refs,
    output_refs,
    previous_event_hash: input.previous_event_hash,
    transition_hash,
    occurred_at: input.occurred_at,
    actor: input.actor,
    runtime_version: input.runtime_version,
    request_id: input.request_id,
  };
}

/** Recompute transition_hash and verify it matches (immutability / integrity check). */
export function verifyExecutionEventIntegrity(event: ExecutionEvent): boolean {
  const expected = computeTransitionHash({
    execution_id: event.execution_id,
    sequence: event.sequence,
    from_state: event.from_state,
    to_state: event.to_state,
    stage: event.stage,
    input_refs: event.input_refs,
    output_refs: event.output_refs,
    previous_event_hash: event.previous_event_hash,
  });
  return expected === event.transition_hash;
}
