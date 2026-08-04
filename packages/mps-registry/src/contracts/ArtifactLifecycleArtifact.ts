import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export type ArtifactLifecycleState = "ACTIVE" | "SUPERSEDED" | "ARCHIVED" | "INVALIDATED";

export interface ArtifactLifecycleTransitionArtifact extends CanonicalArtifact {
  readonly artifact_type: "ARTIFACT_LIFECYCLE_TRANSITION_ARTIFACT";

  readonly target_artifact_ref: ContentReference;
  readonly from_state: ArtifactLifecycleState;
  readonly to_state: ArtifactLifecycleState;
  
  // LIFE-24-15-I4: Deterministic Supersession
  readonly superseding_artifact_ref?: ContentReference;
  
  readonly transition_reason?: string;
  readonly transition_timestamp: string;
}
