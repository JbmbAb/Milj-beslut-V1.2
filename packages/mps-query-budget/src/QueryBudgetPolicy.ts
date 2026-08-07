/**
 * QueryBudgetPolicy — operational limits only (MIMER-BUD-I01..I04).
 *
 * Budget evaluates already-authorized retrieval plans.
 * Budget MUST NOT alter identity, lineage, CAS, or authority.
 * Budget MUST NOT override Retrieval Policy violations.
 */

export const QUERY_BUDGET_POLICY_VERSION = "budget-policy-1" as const;

export const MIMER_BUD_I01 = "MIMER-BUD-I01" as const;
export const MIMER_BUD_I02 = "MIMER-BUD-I02" as const;
export const MIMER_BUD_I03 = "MIMER-BUD-I03" as const;
export const MIMER_BUD_I04 = "MIMER-BUD-I04" as const;

/** Soft-first: warn + continue (not block) in v1. */
export type BudgetMode = "SOFT";

export type QueryBudgetPolicy = {
  readonly policy_version: string;
  readonly mode: BudgetMode;
  /** Soft warning threshold (same units as CostEstimate.estimated_cost). */
  readonly soft_limit: number;
  /** Exceeded threshold — still continue in SOFT mode; emit QUERY_BUDGET_EXCEEDED. */
  readonly hard_observe_limit: number;
  readonly weights: CostWeights;
};

export type CostWeights = {
  readonly alpha_artifact: number;
  readonly beta_evidence_expansion: number;
  readonly gamma_token_proxy: number;
  readonly delta_reranker: number;
};

export const DEFAULT_QUERY_BUDGET_POLICY: QueryBudgetPolicy = Object.freeze({
  policy_version: QUERY_BUDGET_POLICY_VERSION,
  mode: "SOFT",
  soft_limit: 1.0,
  hard_observe_limit: 5.0,
  weights: Object.freeze({
    alpha_artifact: 0.01,
    beta_evidence_expansion: 0.05,
    gamma_token_proxy: 0.001,
    delta_reranker: 0.02,
  }),
});

export class QueryBudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "QueryBudgetError";
  }
}
