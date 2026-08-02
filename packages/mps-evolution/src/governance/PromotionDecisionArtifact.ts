import { CanonicalArtifact, ContentReference } from "../core/types.js";
import { ActorReference } from "../core/ActorReference.js";
import { FitnessScore } from "../fitness/FitnessEngine.js";

export interface PromotionDecisionArtifact extends CanonicalArtifact {
    artifact_type: "PROMOTION_DECISION";
    candidate_ref: ContentReference;
    evaluation_ref: ContentReference;
    constraints_ref: ContentReference;
    fitness: FitnessScore;
    approved: boolean;
    reason: string;
    decided_by: ActorReference;
    evaluated_at: string;
}
