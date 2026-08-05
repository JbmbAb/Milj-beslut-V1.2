/**
 * Runtime Contract Freeze (Fas −1)
 *
 * These shapes are FROZEN. Implementations SHALL NOT mutate identity fields
 * or widen/narrow required members without a new artifact major version.
 *
 * @freeze mps-execution-contracts@1.0.0
 */

import type { ContentHash } from "../../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../../mps-compliance/src/artifacts/ArtifactReference.js";

/** Opaque content hash — MUST be computed over CanonicalBytes only. */
export type FrozenContentHash = ContentHash;

export interface FrozenExecutionManifestIdentity {
  readonly manifest_id: string;
  readonly artifact_type: "execution_manifest";
  readonly execution_identity_ref: ArtifactReference;
  readonly capability_resolution_ref: ArtifactReference;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly content_hash: FrozenContentHash;
}

export interface FrozenExecutionAttemptIdentity {
  readonly attempt_id: string;
  readonly artifact_type: "execution_attempt";
  readonly manifest_ref: ArtifactReference;
  readonly attempt_number: number;
  /** Deterministic ISO-8601 or seed-derived instant — never wall-clock in identity. */
  readonly started_at: string;
  readonly content_hash: FrozenContentHash;
}

export type FrozenExecutionOutcomeResult = "success" | "failure" | "aborted";

export interface FrozenExecutionOutcomeIdentity {
  readonly outcome_id: string;
  readonly artifact_type: "execution_outcome";
  readonly attempt_ref: ArtifactReference;
  readonly result: FrozenExecutionOutcomeResult;
  readonly content_hash: FrozenContentHash;
}

export type AdmissionDecision = "admitted" | "denied";

export interface FrozenAdmissionResult {
  readonly decision: AdmissionDecision;
  readonly reason_codes: readonly string[];
  readonly manifest_ref: ArtifactReference;
  readonly attempt_ref: ArtifactReference | null;
  readonly verified_rule_ids: readonly string[];
}

export interface FrozenCapabilityExecutionArtifact {
  readonly artifact_id: string;
  readonly artifact_type: "CAPABILITY_EXECUTION";
  readonly capability_ref: ArtifactReference;
  readonly input_refs: readonly ArtifactReference[];
  readonly output_refs: readonly ArtifactReference[];
  readonly content_hash: FrozenContentHash;
}

export interface FrozenWorkflowExecutionArtifact {
  readonly artifact_id: string;
  readonly artifact_type: "WORKFLOW_EXECUTION";
  readonly workflow_definition_ref: ArtifactReference;
  /** Ordered capability execution refs (replay spine). */
  readonly execution_refs: readonly ArtifactReference[];
  /** Explicit execution order (indexes into execution_refs or step ids). */
  readonly execution_order: readonly string[];
  readonly workflow_hash: FrozenContentHash;
  readonly workflow_definition_hash: FrozenContentHash;
  readonly content_hash: FrozenContentHash;
}

export interface FrozenReplayArtifact {
  readonly artifact_id: string;
  readonly artifact_type: "REPLAY";
  readonly manifest_ref: ArtifactReference;
  readonly replayed_outcome_ref: ArtifactReference;
  readonly equivalence_proof: FrozenContentHash;
  readonly content_hash: FrozenContentHash;
}

/**
 * ExecutionTicket — queue contract frozen early; durable impl in Fas 4.
 */
export type ExecutionTicketStatus =
  | "pending"
  | "leased"
  | "running"
  | "completed"
  | "failed"
  | "retry";

export interface FrozenExecutionTicket {
  readonly ticket_id: string;
  readonly manifest_ref: ArtifactReference;
  readonly attempt_ref: ArtifactReference | null;
  readonly lease_ref: string | null;
  readonly status: ExecutionTicketStatus;
}

/** Schema freeze marker for type-lock tests. */
export const EXECUTION_CONTRACT_FREEZE_VERSION = "1.0.0" as const;

export const FROZEN_ARTIFACT_TYPES = [
  "execution_manifest",
  "execution_attempt",
  "execution_outcome",
  "CAPABILITY_EXECUTION",
  "WORKFLOW_EXECUTION",
  "REPLAY",
] as const;
