import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export type ReleaseHash = string;

export interface LUProjectContextPayload {
  /** Persisted product identity this immutable context belongs to. */
  readonly project_id: string;
  readonly project_name: string;
  readonly description: string;
  readonly planned_activity?: string;
  readonly activity_category?: string;
  readonly property_refs: readonly ArtifactReference[];
  readonly created_by: string;
  /** Immutable property binding shared with the bound property context. */
  readonly project_property_binding_ref: ArtifactReference;
  /** Content/contract version used to derive this context artifact. */
  readonly context_contract_version: string;
}

export interface LUProjectContextArtifact extends ArtifactContract {
  readonly artifact_type: "LU_PROJECT_CONTEXT";
  readonly payload: LUProjectContextPayload;
}
