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
import { sha256ContentHash } from "../../../../mps-compliance/src/canonical/sha256Canonical.js";

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

export const FROZEN_EXECUTION_OUTCOME_CONTRACT_VERSION_V2 = "frozen-execution-outcome-v2" as const;

/** Historical V1 shape. It remains readable but cannot self-rehash its hidden capability input. */
export interface FrozenExecutionOutcomeIdentityV1 {
  readonly outcome_id: string;
  readonly artifact_type: "execution_outcome";
  readonly attempt_ref: ArtifactReference;
  readonly result: FrozenExecutionOutcomeResult;
  readonly content_hash: FrozenContentHash;
}

/** V2 persists every semantic input used by its canonical content hash. */
export interface FrozenExecutionOutcomeIdentityV2 {
  readonly outcome_id: string;
  readonly artifact_type: "execution_outcome";
  readonly outcome_contract_version: typeof FROZEN_EXECUTION_OUTCOME_CONTRACT_VERSION_V2;
  readonly attempt_ref: ArtifactReference;
  readonly result: FrozenExecutionOutcomeResult;
  readonly capability_execution_ref: ArtifactReference;
  readonly content_hash: FrozenContentHash;
}

export type FrozenExecutionOutcomeIdentity =
  | FrozenExecutionOutcomeIdentityV1
  | FrozenExecutionOutcomeIdentityV2;

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

export function frozenExecutionOutcomeCanonicalBodyV2(args: {
  readonly artifact_type: "execution_outcome";
  readonly outcome_contract_version: typeof FROZEN_EXECUTION_OUTCOME_CONTRACT_VERSION_V2;
  readonly attempt_ref: ArtifactReference;
  readonly result: FrozenExecutionOutcomeResult;
  readonly capability_execution_ref: ArtifactReference;
}) {
  return {
    artifact_type: args.artifact_type,
    outcome_contract_version: args.outcome_contract_version,
    attempt_ref: args.attempt_ref,
    result: args.result,
    capability_execution_ref: args.capability_execution_ref,
  } as const;
}

export function createFrozenExecutionOutcomeIdentityV2(args: {
  readonly attempt_ref: ArtifactReference;
  readonly result: FrozenExecutionOutcomeResult;
  readonly capability_execution_ref: ArtifactReference;
}): FrozenExecutionOutcomeIdentityV2 {
  if (args.capability_execution_ref.artifact_type !== "CAPABILITY_EXECUTION") {
    throw new Error("REJECT_FROZEN_EXECUTION_OUTCOME: capability_execution_ref type");
  }
  const body = frozenExecutionOutcomeCanonicalBodyV2({
    artifact_type: "execution_outcome",
    outcome_contract_version: FROZEN_EXECUTION_OUTCOME_CONTRACT_VERSION_V2,
    attempt_ref: args.attempt_ref,
    result: args.result,
    capability_execution_ref: args.capability_execution_ref,
  });
  const content_hash = sha256ContentHash(body);
  return {
    outcome_id: `outcome-v2-${args.attempt_ref.artifact_id}`,
    ...body,
    content_hash,
  };
}

/** V1 is historical-only; V2 self-validates entirely from its persisted body. */
export function validateFrozenExecutionOutcomeIdentity(outcome: FrozenExecutionOutcomeIdentity): void {
  if (!("outcome_contract_version" in outcome)) {
    if (outcome.outcome_id.startsWith("outcome-v2-")) {
      throw new Error("REJECT_FROZEN_EXECUTION_OUTCOME: contract version");
    }
    return;
  }
  if (outcome.outcome_contract_version !== FROZEN_EXECUTION_OUTCOME_CONTRACT_VERSION_V2) {
    throw new Error("REJECT_FROZEN_EXECUTION_OUTCOME: contract version");
  }
  if (outcome.capability_execution_ref.artifact_type !== "CAPABILITY_EXECUTION") {
    throw new Error("REJECT_FROZEN_EXECUTION_OUTCOME: capability_execution_ref type");
  }
  const body = frozenExecutionOutcomeCanonicalBodyV2(outcome);
  const expected = sha256ContentHash(body);
  if (
    outcome.outcome_id !== `outcome-v2-${outcome.attempt_ref.artifact_id}` ||
    expected.value !== outcome.content_hash.value ||
    !sameReference(body.capability_execution_ref, outcome.capability_execution_ref)
  ) {
    throw new Error("REJECT_FROZEN_EXECUTION_OUTCOME: canonical payload");
  }
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
  "execution_session",
  "CAPABILITY_EXECUTION",
  "WORKFLOW_EXECUTION",
  "REPLAY",
] as const;
