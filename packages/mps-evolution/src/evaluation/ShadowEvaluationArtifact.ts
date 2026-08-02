import { CanonicalArtifact, ContentReference } from "../core/types.js";

export interface ShadowMetrics {
    latency_ms: number;
    cost: number;
    quality: number;
    errors: number;
}

export interface ShadowEvaluationArtifact extends CanonicalArtifact {
    artifact_type: "SHADOW_EVALUATION";
    candidate_ref: ContentReference;
    baseline_ref: ContentReference;
    metrics: ShadowMetrics;
    evaluator_version: ContentReference;
    created_by: ContentReference;
}
