import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface PromotionDecisionArtifact extends CanonicalArtifact {
  readonly artifact_type: "PROMOTION_DECISION_ARTIFACT";

  readonly candidate_ref: ContentReference;
  readonly evaluation_ref: ContentReference;

  readonly governance_approval_ref: ContentReference;

  readonly decision: "PROMOTE" | "REJECT";
}
