/**
 * RetrievalPolicy — frozen policy shape (versionable, deterministic).
 *
 * CAS answers: what is true?
 * Materialization answers: how is truth produced?
 * Retrieval Governance answers: what may intelligence use?
 */

import type { ArtifactAccessRule, ArtifactClass, QueryType } from "./ArtifactAccessRules.js";
import { getAccessRule, RetrievalGovernanceError } from "./ArtifactAccessRules.js";

export const RETRIEVAL_POLICY_VERSION = "ret-policy-1" as const;

export const MIMER_RET_I01 = "MIMER-RET-I01" as const;
export const MIMER_RET_I02 = "MIMER-RET-I02" as const;
export const MIMER_RET_I03 = "MIMER-RET-I03" as const;

export type RetrievalPolicy = {
  readonly policy_version: string;
  readonly query_type: QueryType;
  readonly access: ArtifactAccessRule;
  /** Always true for v1 — retrieval is read-only (MIMER-RET-I03). */
  readonly read_only: true;
  /** Expand to evidence refs after DecisionImpact (policy-gated). */
  readonly allow_evidence_expansion: boolean;
  /** Expand to raw chunks — never as initial target (MIMER-RET-I01). */
  readonly allow_raw_expansion: boolean;
};

export type ClassifiedQuery = {
  readonly intent: string;
  readonly query_type: QueryType;
};

/**
 * Deterministic query classification from intent keywords (no LLM).
 */
export function classifyQuery(intent: string): ClassifiedQuery {
  const lower = intent.toLowerCase();
  let query_type: QueryType = "GENERAL";
  if (lower.includes("provenance") || lower.includes("audit") || lower.includes("underlag")) {
    query_type = "PROVENANCE_AUDIT";
  } else if (lower.includes("expand") || lower.includes("evidence detail")) {
    query_type = "EVIDENCE_EXPANSION";
  } else if (lower.includes("summary") || lower.includes("sammanfatt")) {
    query_type = "DECISION_SUMMARY";
  }
  return Object.freeze({ intent, query_type });
}

export function buildRetrievalPolicy(
  query_type: QueryType,
  policy_version: string = RETRIEVAL_POLICY_VERSION,
): RetrievalPolicy {
  const access = getAccessRule(query_type);

  if (access.initial !== "DecisionImpactArtifact") {
    throw new RetrievalGovernanceError(
      "MIMER_RET_I01_VIOLATION",
      `${MIMER_RET_I01}: initial artifact MUST be DecisionImpactArtifact, got ${access.initial}`,
    );
  }

  const allow_evidence_expansion =
    access.optional.includes("EvidenceReference") ||
    access.optional.includes("EvidenceSet") ||
    access.allowed.includes("EvidenceSet");

  const allow_raw_expansion =
    access.optional.includes("RawDocumentChunk") ||
    access.allowed.includes("RawDocumentChunk");

  return Object.freeze({
    policy_version,
    query_type,
    access,
    read_only: true,
    allow_evidence_expansion,
    allow_raw_expansion,
  });
}

/** Assert a requested class is permitted under the policy. */
export function assertArtifactClassAllowed(
  policy: RetrievalPolicy,
  artifact_class: ArtifactClass,
): void {
  if (policy.access.forbidden.includes(artifact_class)) {
    throw new RetrievalGovernanceError(
      "MIMER_RET_I02_VIOLATION",
      `${MIMER_RET_I02}: artifact class ${artifact_class} forbidden for ${policy.query_type}`,
    );
  }
  const permitted =
    policy.access.allowed.includes(artifact_class) ||
    policy.access.optional.includes(artifact_class);
  if (!permitted) {
    throw new RetrievalGovernanceError(
      "MIMER_RET_I02_VIOLATION",
      `${MIMER_RET_I02}: artifact class ${artifact_class} not permitted for ${policy.query_type}`,
    );
  }
}
