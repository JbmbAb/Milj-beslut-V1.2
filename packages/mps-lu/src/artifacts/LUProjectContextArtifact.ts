import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export type ReleaseHash = string;

export interface LUProjectContextPayload {
  /** Persisted product identity on canonical product contexts. */
  readonly project_id?: string;
  readonly project_name: string;
  readonly description: string;
  readonly planned_activity?: string;
  readonly activity_category?: string;
  readonly property_refs: readonly ArtifactReference[];
  readonly created_by: string;
  /** Immutable property binding shared with the bound property context. */
  readonly project_property_binding_ref?: ArtifactReference;
  /** Present when this context was content-derived under the product contract. */
  readonly context_contract_version?: string;
}

export interface LUProjectContextArtifact extends ArtifactContract {
  readonly artifact_type: "LU_PROJECT_CONTEXT";
  readonly payload: LUProjectContextPayload;
}
