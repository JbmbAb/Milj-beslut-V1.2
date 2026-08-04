import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface GovernanceArtifact extends CanonicalArtifact {
  readonly governance_key: string;
  readonly governance_version: string;

  readonly subject_ref: ContentReference;
}
