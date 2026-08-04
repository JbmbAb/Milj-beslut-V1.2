import { ContentReference } from "../types.js";
import { PromotionDecisionArtifact } from "@miljobeslut/mps-evolution/src/governance/PromotionDecisionArtifact.js";
import { ArtifactRepository } from "@miljobeslut/mps-evolution/src/artifact/ArtifactRepository.js";

export interface DecisionVisualization {
    candidate_ref: ContentReference;
    evaluation_ref: ContentReference;
    decision_ref: ContentReference;
    // Visuella data representerade som readonly
    summary: string;
}

export class DecisionExplorer {
    constructor(private readonly repository: ArtifactRepository) {}

    async explore(decisionRef: ContentReference): Promise<DecisionVisualization> {
        // Read-only resolution
        const decision = await this.repository.get(decisionRef) as PromotionDecisionArtifact;

        if (decision.artifact_type !== "PROMOTION_DECISION") {
            throw new Error("Can only explore PROMOTION_DECISION artifacts");
        }

        return {
            decision_ref: decisionRef,
            candidate_ref: decision.candidate_ref,
            evaluation_ref: decision.evaluation_ref,
            summary: decision.reason
        };
    }
}
