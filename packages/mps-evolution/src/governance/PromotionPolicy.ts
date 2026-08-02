import { ArtifactRepository } from "../artifact/CasArtifactRepository.js";
import { DefaultFitnessEngine } from "../fitness/FitnessEngine.js";
import { PromotionRequest } from "./PromotionRequest.js";
import { PromotionDecisionArtifact } from "./PromotionDecisionArtifact.js";
import { SYSTEM_ACTOR } from "../core/ActorReference.js";
import { ShadowEvaluationArtifact } from "../evaluation/ShadowEvaluationArtifact.js";

export class PromotionPolicy {
    constructor(
        private repository: ArtifactRepository,
        private fitnessEngine: DefaultFitnessEngine
    ) {}

    async evaluate(request: PromotionRequest): Promise<PromotionDecisionArtifact> {
        // Evaluate candidate just to ensure it exists (we might not need it for fitness, but it must be resolvable)
        const candidate = await this.repository.get(request.candidate_ref);
        const evaluation = await this.repository.get<ShadowEvaluationArtifact>(request.evaluation_ref);

        if (evaluation.candidate_ref.hash !== request.candidate_ref.hash) {
            throw new Error("FITNESS_CANDIDATE_MISMATCH");
        }

        const fitness = this.fitnessEngine.calculate(evaluation);

        return {
            artifact_type: "PROMOTION_DECISION",
            candidate_ref: request.candidate_ref,
            evaluation_ref: request.evaluation_ref,
            constraints_ref: request.constraints_ref,
            fitness,
            approved: fitness.value > 0.8,
            reason: "fitness threshold evaluation",
            decided_by: SYSTEM_ACTOR,
            evaluated_at: new Date().toISOString(),
            content_hash: "", // Will be assigned by canonicalization pipeline
            schema_version: "1.0",
            signature: {
                algorithm: "SHA256",
                value: "" // Will be assigned by signing pipeline
            }
        };
    }
}
