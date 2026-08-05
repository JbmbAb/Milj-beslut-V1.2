import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { RelevantDocument } from "../domain/RelevantDocument";

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
