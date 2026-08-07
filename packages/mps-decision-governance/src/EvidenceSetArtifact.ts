// packages/mps-decision-governance/src/EvidenceSetArtifact.ts

import type { Timestamp } from "../../mps-core/src/types";
import type { DecisionType, JurisdictionLevel } from "./DecisionImpactIdentity";

export interface EvidenceDocumentReference {
  readonly document_hash: string;
  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly country_code?: string;
  readonly case_id?: string;
}

/**
 * Lineage scope — the dimension a lineage chain is monotonic within.
 * Scope stability is enforced by validateEvidenceSetLineage.
 */
export interface EvidenceSetLineageScope {
  readonly jurisdiction_level: JurisdictionLevel;
  readonly decision_type: DecisionType;
}

/**
 * Identity = content + schema + lineage position. Never contains its own hash.
 */
export interface EvidenceSetIdentity {
  readonly documents: readonly EvidenceDocumentReference[];
  readonly schema_version: number;
  readonly lineage_sequence: number;
  readonly previous_evidence_set_hash?: string;
  readonly lineage_scope: EvidenceSetLineageScope;
}

/**
 * Metadata = runtime/audit, never affects identity.
 */
export interface EvidenceSetMetadata {
  readonly created_at: Timestamp;
  readonly materialization_version: string;
  readonly generated_by: string;
}

/**
 * Full artifact: hash(identity) + identity + metadata.
 */
export interface EvidenceSetArtifact {
  readonly evidence_set_hash: string; // SHA-256(canonical_version || canonical(identity))
  readonly identity: EvidenceSetIdentity;
  readonly metadata: EvidenceSetMetadata;
}

/**
 * Schema freeze: changing these lists is an identity change and requires an ADR
 * plus a new schema_version.
 */
export const EVIDENCE_SET_IDENTITY_FIELDS = Object.freeze([
  "documents",
  "schema_version",
  "lineage_sequence",
  "previous_evidence_set_hash",
  "lineage_scope",
] as const);

export const EVIDENCE_SET_LINEAGE_SCOPE_FIELDS = Object.freeze([
  "jurisdiction_level",
  "decision_type",
] as const);
