import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";

export interface LUPropertyContextPayload {
  readonly property_ref: string; // The external fastighetsbeteckning identifier (e.g. "ABC 1:123")
  readonly official_name: string;
  readonly geometry_ref: ArtifactReference; // Reference to the CanonicalGeometry artifact
  readonly municipality: string;
  readonly coordinates: readonly [number, number]; // e.g. SWEREF99 TM [N, E]
}

export interface LUPropertyContextArtifact extends ArtifactContract {
  readonly artifact_type: "LU_PROPERTY_CONTEXT";
  readonly payload: LUPropertyContextPayload;
}
