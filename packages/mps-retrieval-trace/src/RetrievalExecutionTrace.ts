/**
 * RetrievalExecutionTraceArtifact — observation surface (Commit F).
 *
 * Not authority. Not cache. Not DecisionImpact.
 *
 * Identity (enters trace_hash):
 *   query_hash, policy_version, artifact_snapshot, selected_refs
 *
 * Metadata (excluded):
 *   duration_ms, estimated_cost, token_estimate, executed_at, user, model
 *
 * TRACE-I02: RetrievalTrace SHALL NEVER create DecisionImpactArtifact authority.
 */

import { hashTraceCanonical } from "./canonicalTraceHash.js";

export const RETRIEVAL_TRACE_CONTRACT_VERSION = "ret-trace-1" as const;

export const TRACE_I01 = "TRACE-I01" as const;
export const TRACE_I02 = "TRACE-I02" as const;
/** @deprecated Use TRACE_I03 — renamed to avoid collision with MIMER-RET-I05 (Raw Chunk Non-Authority). */
export const RET_I05 = "TRACE-I03" as const;
export const TRACE_I03 = "TRACE-I03" as const;

export type RetrievalTraceIdentity = {
  readonly query_hash: string;
  readonly policy_version: string;
  readonly artifact_snapshot: string;
  readonly selected_artifact_refs: readonly string[];
  readonly budget_profile: string;
  readonly expansion_path: readonly string[];
};

export type RetrievalTraceMetadata = {
  readonly duration_ms?: number;
  readonly estimated_cost?: number;
  readonly token_estimate?: number;
  readonly executed_at?: string;
  readonly user_id?: string;
  readonly model_name?: string;
};

export type RetrievalExecutionTraceArtifact = {
  readonly trace_hash: string;
  readonly contract_version: typeof RETRIEVAL_TRACE_CONTRACT_VERSION;
  readonly identity: RetrievalTraceIdentity;
  readonly metadata: RetrievalTraceMetadata;
};

export class RetrievalTraceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetrievalTraceError";
  }
}

export function buildTraceIdentityPayload(
  identity: RetrievalTraceIdentity,
): Record<string, unknown> {
  return {
    query_hash: identity.query_hash,
    policy_version: identity.policy_version,
    artifact_snapshot: identity.artifact_snapshot,
    selected_artifact_refs: [...identity.selected_artifact_refs].sort(),
    budget_profile: identity.budget_profile,
    expansion_path: [...identity.expansion_path],
  };
}

export function computeTraceHash(identity: RetrievalTraceIdentity): string {
  return hashTraceCanonical(buildTraceIdentityPayload(identity));
}

export function createRetrievalExecutionTrace(
  identity: RetrievalTraceIdentity,
  metadata: RetrievalTraceMetadata = {},
): RetrievalExecutionTraceArtifact {
  const trace_hash = computeTraceHash(identity);
  return Object.freeze({
    trace_hash,
    contract_version: RETRIEVAL_TRACE_CONTRACT_VERSION,
    identity: Object.freeze({
      ...identity,
      selected_artifact_refs: Object.freeze([
        ...identity.selected_artifact_refs,
      ].sort()),
      expansion_path: Object.freeze([...identity.expansion_path]),
    }),
    metadata: Object.freeze({ ...metadata }),
  });
}

/** TRACE-I02 — Trace layer has no write path into Decision Truth. */
export function assertTraceCannotCreateAuthority(action: "write_decision_impact"): void {
  throw new RetrievalTraceError(
    "TRACE_I02_VIOLATION",
    `${TRACE_I02}: RetrievalTrace SHALL NEVER ${action} — observation only`,
  );
}
