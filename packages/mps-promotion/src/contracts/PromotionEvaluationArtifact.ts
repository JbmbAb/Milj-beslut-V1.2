import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface PromotionEvaluationArtifact extends CanonicalArtifact {
  readonly artifact_type: "PROMOTION_EVALUATION_ARTIFACT";

  readonly candidate_ref: ContentReference;
  readonly passed: boolean;
  readonly evaluation_details: string;
}
