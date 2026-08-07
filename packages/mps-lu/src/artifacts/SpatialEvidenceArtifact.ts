import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";

export interface SpatialEvidencePayload {
  readonly property_ref: ArtifactReference;
  readonly layer_ref: {
    readonly layer_id: string;
    readonly layer_version: string;
  };
  /** Coordinate reference system of `geometry`; SWEREF99 TM is 3006. */
  readonly srid: number;
  /** What was computed, and by which engine (TV-S1 SV-I03). */
  readonly operation: {
    readonly algorithm: string;
    readonly engine: string;
    readonly engine_fingerprint: Record<string, string>;
  };
  readonly geometry: CanonicalGeometry | null;
  /** `retrieved_at` is provenance and stays outside the identity domain (SV-I06). */
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
