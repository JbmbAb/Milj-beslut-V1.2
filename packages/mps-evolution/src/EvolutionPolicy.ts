import type { EvolutionArtifact } from "./EvolutionTypes";

export interface EvolutionPolicy {
  readonly allowed_models: readonly string[];
  readonly max_mutation_ratio: number;
  readonly require_replay: boolean;
  readonly require_audit: boolean;
  readonly min_quality_gain: number;
  readonly max_regression_latency: number;
  readonly promotion_requires_review: boolean;
}

export interface EvolutionPolicySet {
  readonly schema_version: "evolution.policy.v1";
  readonly policies: EvolutionPolicy;
}

export type EvolutionPromotionDecision = "PROMOTE" | "REJECT";

export interface EvolutionPolicyEngine {
  decide(
    artifact: EvolutionArtifact
  ): Promise<EvolutionPromotionDecision>;
}
