import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export interface LUPropertyContextPayload {
  readonly property_ref: string; // The external fastighetsbeteckning identifier (e.g. "ABC 1:123")
  readonly official_name: string;
  readonly geometry_ref: ArtifactReference; // Reference to the CanonicalGeometry artifact
  readonly municipality: string;
  readonly coordinates: readonly [number, number]; // e.g. SWEREF99 TM [N, E]
  /** Present on canonical product contexts; historical LU contexts remain readable. */
  readonly project_property_binding_ref?: ArtifactReference;
  /** Canonical source identity on product contexts, distinct from designation. */
  readonly property_identity?: string;
  /** Present when this context was content-derived under the product contract. */
  readonly context_contract_version?: string;
}

export interface LUPropertyContextArtifact extends ArtifactContract {
  readonly artifact_type: "LU_PROPERTY_CONTEXT";
  readonly payload: LUPropertyContextPayload;
}
