/**
 * Execution Contracts & Model — semantic surface (Epoch II §2.2).
 *
 * Objects describe what happened; policies describe what is allowed.
 * Identity field sets for ADR-29 types remain frozen — this module aliases
 * them and adds Session + policy contracts.
 *
 * @see FrozenIdentities (ADR-29)
 */

import type { ArtifactReference } from "../../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type {
  FrozenAdmissionResult,
  FrozenContentHash,
  FrozenExecutionAttemptIdentity,
  FrozenExecutionManifestIdentity,
  FrozenExecutionOutcomeIdentity,
  FrozenExecutionTicket,
  FrozenReplayArtifact,
} from "../freeze/FrozenIdentities.js";

/** Canonical names used by Execution Platform docs / clients. */
export type ExecutionManifest = FrozenExecutionManifestIdentity;
export type ExecutionAttempt = FrozenExecutionAttemptIdentity;
export type ExecutionOutcome = FrozenExecutionOutcomeIdentity;
export type AdmissionResult = FrozenAdmissionResult;

/** Durable queue ticket bound to a manifest. */
export type TicketIdentity = FrozenExecutionTicket;

/** Replay identity binding — equivalence over immutable artifacts. */
export type ReplayIdentity = {
  readonly artifact_id: string;
  readonly artifact_type: "REPLAY";
  readonly manifest_ref: ArtifactReference;
  readonly replayed_outcome_ref: ArtifactReference;
  readonly equivalence_proof: FrozenContentHash;
  readonly content_hash: FrozenContentHash;
};

export function toReplayIdentity(replay: FrozenReplayArtifact): ReplayIdentity {
  return {
    artifact_id: replay.artifact_id,
    artifact_type: "REPLAY",
    manifest_ref: replay.manifest_ref,
    replayed_outcome_ref: replay.replayed_outcome_ref,
    equivalence_proof: replay.equivalence_proof,
    content_hash: replay.content_hash,
  };
}

/**
 * Correlates ticket / attempts / outcome / replays for one admitted run.
 * Additive to ADR-29 freeze (new artifact type).
 */
export interface ExecutionSession {
  readonly session_id: string;
  readonly artifact_type: "execution_session";
  readonly manifest_ref: ArtifactReference;
  readonly ticket_ref: ArtifactReference | null;
  readonly attempt_refs: readonly ArtifactReference[];
  readonly outcome_ref: ArtifactReference | null;
  readonly replay_refs: readonly ArtifactReference[];
  readonly policy_id: string;
  readonly content_hash: FrozenContentHash;
}

export const EXECUTION_MODEL_VERSION = "1.0.0" as const;

export const EXECUTION_MODEL_CONTRACT_NAMES = [
  "ExecutionManifest",
  "ExecutionAttempt",
  "ExecutionOutcome",
  "ExecutionSession",
  "ReplayIdentity",
  "TicketIdentity",
  "ExecutionPolicy",
  "AdmissionPolicy",
  "RetryPolicy",
] as const;
