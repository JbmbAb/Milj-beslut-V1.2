import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface RegistryArtifact extends CanonicalArtifact {
  readonly artifact_type: "REGISTRY_ENTRY";

  /**
   * Semantic metadata only.
   * SHALL NOT affect canonical identity.
   */
  readonly registry_key: string;

  /**
   * Canonical truth reference.
   * Registry does not own artifacts, it points at them.
   */
  readonly artifact_ref: ContentReference;

  /**
   * Optional provenance chain.
   */
  readonly source_application_ref?: ContentReference;
  readonly source_workflow_ref?: ContentReference;
  readonly source_capability_ref?: ContentReference;
}
