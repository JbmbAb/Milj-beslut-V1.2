import { PromotionDecisionArtifact } from "../contracts/PromotionDecisionArtifact.js";

export interface PromotionProvenanceValidator {
  validate(decision: PromotionDecisionArtifact): void;
}
