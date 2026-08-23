import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export interface LUPropertyContextPayload {
  readonly property_ref: string; // The external fastighetsbeteckning identifier (e.g. "ABC 1:123")
  readonly official_name: string;
  readonly geometry_ref: ArtifactReference; // Reference to the CanonicalGeometry artifact
  readonly municipality: string;
  readonly coordinates: readonly [number, number]; // e.g. SWEREF99 TM [N, E]
  /** Immutable binding that authorizes this context for product use. */
  readonly project_property_binding_ref: ArtifactReference;
  /** Canonical source identity of the property, distinct from its designation. */
  readonly property_identity: string;
  /** Content/contract version used to derive this context artifact. */
  readonly context_contract_version: string;
}

export interface LUPropertyContextArtifact extends ArtifactContract {
  readonly artifact_type: "LU_PROPERTY_CONTEXT";
  readonly payload: LUPropertyContextPayload;
}
