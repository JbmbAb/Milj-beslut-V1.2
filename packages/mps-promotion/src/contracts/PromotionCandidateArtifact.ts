import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface PromotionCandidateArtifact extends CanonicalArtifact {
  readonly artifact_type: "PROMOTION_CANDIDATE_ARTIFACT";

  readonly candidate_key: string;
  readonly candidate_version: string;

  readonly subject_ref: ContentReference;
}
