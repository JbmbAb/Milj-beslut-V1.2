import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";

export interface SpatialEvidencePayload {
  readonly property_ref: ArtifactReference;
  readonly layer_ref: {
    readonly layer_id: string;
    readonly layer_version: string;
  };
  readonly geometry: CanonicalGeometry;
  readonly source_metadata: {
    readonly provider: string;
    readonly dataset: string;
    readonly dataset_version: string;
    readonly retrieved_at: string; // ISO8601
  };
  readonly query_context: {
    readonly query_id: string;
    readonly query_type: string;
    readonly parameters: Record<string, any>;
  };
}

export interface SpatialEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "SPATIAL_EVIDENCE";
  readonly payload: SpatialEvidencePayload;
}
