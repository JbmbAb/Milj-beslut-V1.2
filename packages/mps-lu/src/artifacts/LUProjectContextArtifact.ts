import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";

export type ReleaseHash = string;

export interface LUProjectContextPayload {
  readonly project_name: string;
  readonly description: string;
  readonly planned_activity?: string;
  readonly activity_category?: string;
  readonly property_refs: readonly ArtifactReference[];
  readonly created_by: string;
}

export interface LUProjectContextArtifact extends ArtifactContract {
  readonly artifact_type: "LU_PROJECT_CONTEXT";
  readonly payload: LUProjectContextPayload;
}
