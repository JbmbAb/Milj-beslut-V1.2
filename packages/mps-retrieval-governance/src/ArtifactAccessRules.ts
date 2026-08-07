/**
 * ArtifactAccessRules — which artifact classes may be read under a query type.
 *
 * MIMER-RET-I02 — Artifact Class Isolation
 */

export type ArtifactClass =
  | "DecisionImpactArtifact"
  | "EvidenceReference"
  | "EvidenceSet"
  | "RawDocumentChunk"
  | "DocumentChunk";

export type QueryType =
  | "GENERAL"
  | "DECISION_SUMMARY"
  | "EVIDENCE_EXPANSION"
  | "PROVENANCE_AUDIT";

export type ArtifactAccessRule = {
  readonly query_type: QueryType;
  readonly allowed: readonly ArtifactClass[];
  readonly optional: readonly ArtifactClass[];
  readonly forbidden: readonly ArtifactClass[];
  /** Constitutional: first class resolved for this query type. */
  readonly initial: ArtifactClass;
};

export const ARTIFACT_ACCESS_RULES: readonly ArtifactAccessRule[] = Object.freeze([
  Object.freeze({
    query_type: "GENERAL",
    allowed: Object.freeze(["DecisionImpactArtifact"] as const),
    optional: Object.freeze(["EvidenceReference", "EvidenceSet"] as const),
    forbidden: Object.freeze(["RawDocumentChunk", "DocumentChunk"] as const),
    initial: "DecisionImpactArtifact",
  }),
  Object.freeze({
    query_type: "DECISION_SUMMARY",
    allowed: Object.freeze(["DecisionImpactArtifact"] as const),
    optional: Object.freeze(["EvidenceReference"] as const),
    forbidden: Object.freeze(["RawDocumentChunk", "DocumentChunk", "EvidenceSet"] as const),
    initial: "DecisionImpactArtifact",
  }),
  Object.freeze({
    query_type: "EVIDENCE_EXPANSION",
    allowed: Object.freeze(["DecisionImpactArtifact", "EvidenceSet", "EvidenceReference"] as const),
    optional: Object.freeze(["RawDocumentChunk"] as const),
    forbidden: Object.freeze(["DocumentChunk"] as const),
    initial: "DecisionImpactArtifact",
  }),
  Object.freeze({
    query_type: "PROVENANCE_AUDIT",
    allowed: Object.freeze([
      "DecisionImpactArtifact",
      "EvidenceSet",
      "EvidenceReference",
      "RawDocumentChunk",
    ] as const),
    optional: Object.freeze([] as const),
    forbidden: Object.freeze(["DocumentChunk"] as const),
    initial: "DecisionImpactArtifact",
  }),
]);

export function getAccessRule(query_type: QueryType): ArtifactAccessRule {
  const rule = ARTIFACT_ACCESS_RULES.find((r) => r.query_type === query_type);
  if (!rule) {
    throw new RetrievalGovernanceError(
      "UNKNOWN_QUERY_TYPE",
      `No ArtifactAccessRule for query_type=${query_type}`,
    );
  }
  return rule;
}

export class RetrievalGovernanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetrievalGovernanceError";
  }
}
