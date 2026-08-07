/**
 * CostEstimator — operational cost of an already-authorized retrieval plan.
 *
 * estimated_cost =
 *   artifact_count * α
 * + evidence_expansion * β
 * + tokens * γ
 * + reranker_cost * δ
 */

import type { CostWeights, QueryBudgetPolicy } from "./QueryBudgetPolicy.js";

/** Quantities derived from authorized expansion strategy — not from raw history. */
export type AuthorizedPlanMetrics = {
  readonly artifact_count: number;
  readonly evidence_expansion_count: number;
  readonly token_proxy: number;
  readonly reranker_cost: number;
};

export type CostEstimate = {
  readonly estimated_cost: number;
  readonly breakdown: {
    readonly artifacts: number;
    readonly evidence_expansion: number;
    readonly tokens: number;
    readonly reranker: number;
  };
  readonly weights: CostWeights;
};

export function estimateCost(
  metrics: AuthorizedPlanMetrics,
  policy: QueryBudgetPolicy,
): CostEstimate {
  const w = policy.weights;
  const artifacts = metrics.artifact_count * w.alpha_artifact;
  const evidence_expansion =
    metrics.evidence_expansion_count * w.beta_evidence_expansion;
  const tokens = metrics.token_proxy * w.gamma_token_proxy;
  const reranker = metrics.reranker_cost * w.delta_reranker;
  const estimated_cost = artifacts + evidence_expansion + tokens + reranker;

  return Object.freeze({
    estimated_cost,
    breakdown: Object.freeze({
      artifacts,
      evidence_expansion,
      tokens,
      reranker,
    }),
    weights: w,
  });
}
