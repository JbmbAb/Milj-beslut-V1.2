import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

// PROM-001
export interface PromotionCandidateArtifact extends CanonicalArtifact {
  readonly artifact_type: "PROMOTION_CANDIDATE_ARTIFACT";

  readonly candidate_key: string;
  readonly candidate_version: string;

  readonly subject_ref: ContentReference;
}

// ADR-24-12: Promotion Compliance Integration Layer
export interface PromotionEvaluationArtifact extends CanonicalArtifact {
  readonly artifact_type: "PROMOTION_EVALUATION_ARTIFACT";

  readonly compliance_ref: ContentReference;
  readonly policy_ref: ContentReference;

  readonly status: "ELIGIBLE" | "BLOCKED";

  readonly evaluator_version: string;
}

export interface PromotionDecisionArtifact extends CanonicalArtifact {
  readonly artifact_type: "PROMOTION_DECISION_ARTIFACT";

  readonly evaluation_ref: ContentReference;
  readonly governance_ref?: ContentReference;

  readonly decision: "APPROVED" | "REJECTED";
}
