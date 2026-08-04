import { CanonicalArtifact, ContentReference, Permission } from "@miljobeslut/mps-evolution";

export interface ApplicationDefinitionArtifact extends CanonicalArtifact {
  readonly artifact_type: "APPLICATION_DEFINITION";

  /**
   * Semantic metadata only.
   * SHALL NOT affect canonical identity.
   */
  readonly application_key: string;
  readonly application_version: string;

  readonly workflow_definition_ref: ContentReference;
  readonly required_permissions: readonly Permission[];
}
