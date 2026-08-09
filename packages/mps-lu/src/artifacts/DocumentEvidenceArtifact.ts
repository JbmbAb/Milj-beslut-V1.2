import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { RelevantDocument } from "../domain/RelevantDocument";

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
  readonly relevant_document: RelevantDocument;
  readonly source_metadata: {
    readonly provider: string;
    readonly retrieved_at: string; // ISO8601
  };
}

export interface DocumentEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "DOCUMENT_EVIDENCE";
  readonly payload: DocumentEvidencePayload;
}
