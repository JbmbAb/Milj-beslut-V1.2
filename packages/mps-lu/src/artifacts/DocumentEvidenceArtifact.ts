import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { RelevantDocument } from "../domain/RelevantDocument";

export interface LegalEvidence {
  readonly source_document: string;
  readonly source_type: "law" | "regulation" | "guidance" | "judgment" | "decision" | "technical" | "unknown";
  readonly authority: string;
  readonly document_date: string; // ISO8601
  readonly effective_from?: string; // ISO8601 temporal valid bounds
  readonly effective_to?: string; // ISO8601 temporal valid bounds
  readonly jurisdiction?: string;
  readonly chunk_id: string;
  readonly source_hash: string;
  readonly claim: string;
  readonly relation: "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT";
  readonly confidence: number; // 0.0 to 1.0
}

export interface RetrievalCandidate {
  readonly id: string;
  readonly document_id: string;
  readonly document_sha256: string;
  readonly chunk_index: number;
  readonly chunkText: string;
  readonly source_path: string;
  readonly retrieval_method: "lexical" | "vector" | "hybrid";
  readonly lexical_score?: number;
  readonly vector_score?: number;
  readonly fused_score: number;
}

export interface RankedEvidence {
  readonly candidate: RetrievalCandidate;
  readonly rerank_score: number; // Computed by cross-encoder or zero-shot ranker
}

export interface EvidenceBundle extends ArtifactContract {
  readonly artifact_type: "EVIDENCE_BUNDLE";
  readonly release_id: string;
  readonly query: string;
  readonly spatial_reference?: {
    readonly property_designation: string;
    readonly municipality: string;
  };
  readonly evidence: RankedEvidence[];
  readonly generated_at: string;
}

export interface DocumentEvidencePayload {
  readonly property_ref: ArtifactReference;
  readonly document_ref: ArtifactReference;
  /**
   * 🔴 LEGACY / NON-AUTHORITATIVE — do not populate in new producers.
   *
   * P3-LU-DOCUMENT-CLASSIFICATION-01 made this optional. It was REQUIRED, which meant no
   * evidence artifact could exist until its document had been classified: observation was
   * structurally forced to carry its own interpretation, and `materialize()` had to be handed a
   * `documentType` before any evidence existed.
   *
   * A value here MUST NOT authorize a document class or a classified LU rule. The authoritative
   * path is DocumentClassificationArtifact, which references this evidence rather than being
   * embedded in it.
   *
   * Target state: REMOVED in the next canonical contract version.
   *
   * @deprecated Use DocumentClassificationArtifact.
   */
  readonly relevant_document?: RelevantDocument;
  /**
   * F4B-0 — references to VERIFIED document facts (Tier 3).
   *
   * OWNER FREEZE 2026-08-12: DocumentEvidenceArtifact does NOT own legal classification
   * authority. Legal facts arise in Tier 3 Inventory/classification and are verified there;
   * this artifact only points at them. Facts are therefore reusable — the same prior decision
   * can be relevant to several future analyses without re-classifying it per LU project.
   *
   * MUST reference `VERIFIED_DOCUMENT_FACT` artifacts only. A `DOCUMENT_FACT_CANDIDATE` is not
   * a legal fact and must never be referenced here.
   *
   * @see packages/mps-data-governance/src/DocumentFactArtifact.ts
   */
  readonly fact_refs?: readonly ArtifactReference[];
  /**
   * F4B-0A — the canonical text boundary.
   *
   * OWNER FREEZE 2026-08-12: document text is owned by the canonical text projection
   * (TEXT-L1, `packages/mps-text-projection`), never by `RelevantDocument`. Evidence points at
   * the projection; it does not embed the text.
   */
  readonly text_projection_ref?: ArtifactReference;
  /**
   * F4B-0B — the Tier 2 origin this evidence was materialized from.
   *
   * The producer has always set this and `RawSourceIngestion.test.ts` has always asserted it, but it
   * was never declared — the third producer/contract gap in this file, found while deriving
   * `references`. Declared here because it is the edge that keeps the chain back to the
   * preserved original traversable.
   *
   * Optional because provider-fetched evidence (`DocumentEvidenceService`) has no quarantined
   * raw source.
   */
  readonly raw_source_ref?: ArtifactReference;
  readonly source_metadata: {
    readonly provider: string;
    readonly retrieved_at: string; // ISO8601
  };
}

export interface DocumentEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "DOCUMENT_EVIDENCE";
  readonly payload: DocumentEvidencePayload;
}
