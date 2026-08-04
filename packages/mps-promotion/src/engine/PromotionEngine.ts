import { ContentReference } from "@miljobeslut/mps-evolution";
import { PromotionEvaluationArtifact } from "../contracts/PromotionEvaluationArtifact.js";
import { PromotionDecisionArtifact } from "../contracts/PromotionDecisionArtifact.js";

export interface PromotionEngine {
  evaluate(
    candidate_ref: ContentReference
  ): Promise<PromotionEvaluationArtifact>;

  decide(
    candidate_ref: ContentReference,
    evaluation_ref: ContentReference,
    governance_approval_ref: ContentReference,
    decision: "PROMOTE" | "REJECT"
  ): Promise<PromotionDecisionArtifact>;
}
