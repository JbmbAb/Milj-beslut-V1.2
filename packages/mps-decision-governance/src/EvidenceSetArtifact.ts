// packages/mps-decision-governance/src/EvidenceSetArtifact.ts

import type { Timestamp } from "../../mps-core/src/types";

export interface EvidenceDocumentReference {
  readonly document_hash: string;
  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly country_code?: string;
  readonly case_id?: string;
}

/**
 * Identity = bara innehåll + schema, ingen hash inuti sig själv.
 */
export interface EvidenceSetIdentity {
  readonly documents: readonly EvidenceDocumentReference[];
  readonly schema_version: number;
  readonly lineage_sequence: number;          // Tillagd för strictly increasing sequence validation (Mimer Engine)
  readonly previous_evidence_set_hash?: string; // immutable append-kedja
}

/**
 * Metadata = runtime/audit, påverkar aldrig identitet.
 */
export interface EvidenceSetMetadata {
  readonly created_at: Timestamp;
  readonly materialization_version: string;
  readonly generated_by: string;
}

/**
 * Full artefakt: hash(identity) + identity + metadata.
 */
export interface EvidenceSetArtifact {
  readonly evidence_set_hash: string; // SHA-256(canonical(identity))
  readonly identity: EvidenceSetIdentity;
  readonly metadata: EvidenceSetMetadata;
}
