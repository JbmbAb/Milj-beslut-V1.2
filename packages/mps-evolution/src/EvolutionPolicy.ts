import type { MutatedCodeArtifact, ScoreArtifact } from "./EvolutionTypes";

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
  readonly policy_id: string;
  readonly policy: EvolutionPolicy;
}

export interface EvolutionPolicyEngine {
  evaluate(candidate: MutatedCodeArtifact, score: ScoreArtifact): boolean;
}

export class DefaultEvolutionPolicyEngine implements EvolutionPolicyEngine {
  constructor(private readonly policySet: EvolutionPolicySet) {}

  evaluate(candidate: MutatedCodeArtifact, score: ScoreArtifact): boolean {
    const p = this.policySet.policy;

    if (score.score < p.min_quality_gain) return false;
    if (score.metrics["latency"] > p.max_regression_latency) return false;

    return true;
  }
}
