import { ShadowEvaluationArtifact } from "../evaluation/ShadowEvaluationArtifact.js";

export interface FitnessScore {
    value: number;
    quality: number;
    latency_penalty: number;
    cost_penalty: number;
    error_penalty: number;
}

export class DefaultFitnessEngine {
    calculate(
        evaluation: ShadowEvaluationArtifact
    ): FitnessScore {
        return {
            value:
                evaluation.metrics.quality -
                evaluation.metrics.cost * 0.2 -
                evaluation.metrics.errors * 0.3,
            quality: evaluation.metrics.quality,
            latency_penalty: evaluation.metrics.latency_ms,
            cost_penalty: evaluation.metrics.cost,
            error_penalty: evaluation.metrics.errors
        };
    }
}
