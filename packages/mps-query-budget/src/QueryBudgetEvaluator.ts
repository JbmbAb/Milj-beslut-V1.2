/**
 * QueryBudgetEvaluator — evaluate cost of an authorized retrieval plan.
 *
 * Order (constitutional):
 *   Retrieval Policy → Allowed classes → Expansion → Budget → Execution
 *
 * MIMER-BUD-I01 Budget Isolation — does not alter identity hashes
 * MIMER-BUD-I02 Budget Is Operational Only
 * MIMER-BUD-I03 Soft Failure First
 * MIMER-BUD-I04 Budget Cannot Hide Policy Violations
 */

import type { RetrievalDecision } from "../../mps-retrieval-governance/src/index.js";
import { estimateCost, type AuthorizedPlanMetrics, type CostEstimate } from "./CostEstimator.js";
import type { BudgetTelemetrySink } from "./BudgetTelemetry.js";
import {
  DEFAULT_QUERY_BUDGET_POLICY,
  MIMER_BUD_I04,
  QueryBudgetError,
  type QueryBudgetPolicy,
} from "./QueryBudgetPolicy.js";

export type BudgetEvaluationStatus = "OK" | "PARTIAL";

export type BudgetEvaluation = {
  readonly status: BudgetEvaluationStatus;
  readonly reason?: "QUERY_BUDGET_SOFT_LIMIT" | "QUERY_BUDGET_OBSERVED_EXCEEDED";
  readonly estimate: CostEstimate;
  readonly policy: QueryBudgetPolicy;
  /** Echo of authorized plan — budget never mutates these. */
  readonly authorized_plan: {
    readonly initial_artifact_class: RetrievalDecision["initial_artifact_class"];
    readonly expand_evidence: boolean;
    readonly expand_raw: boolean;
    readonly policy_version: string;
    readonly denied_reasons: readonly string[];
  };
  /** Identity fingerprints passed through unchanged (BUD-I01 / I02). */
  readonly identity_passthrough: {
    readonly artifact_hash?: string;
    readonly decision_identity_hash?: string;
    readonly materialization_hash?: string;
  };
  readonly continued: true;
};

export type BudgetEvaluationInput = {
  readonly authorized: RetrievalDecision;
  readonly metrics: AuthorizedPlanMetrics;
  /**
   * Snapshot hashes from Decision Truth — echoed unchanged.
   * Budget MUST NOT recompute or alter these.
   */
  readonly identity_passthrough?: {
    readonly artifact_hash?: string;
    readonly decision_identity_hash?: string;
    readonly materialization_hash?: string;
  };
  readonly budget_policy?: QueryBudgetPolicy;
  readonly telemetry?: BudgetTelemetrySink;
  /** Explicit override acknowledgment — still soft-continues; emits OVERRIDE. */
  readonly override?: boolean;
};

/**
 * MIMER-BUD-I04: refuse to evaluate if the retrieval decision still requests
 * a forbidden path (e.g. raw initial). Only authorized plans are budgeted.
 */
export function assertAuthorizedForBudget(authorized: RetrievalDecision): void {
  if (authorized.initial_artifact_class !== "DecisionImpactArtifact") {
    throw new QueryBudgetError(
      "MIMER_BUD_I04_VIOLATION",
      `${MIMER_BUD_I04}: Budget SHALL only evaluate already authorized retrieval plans`,
    );
  }
  if (!authorized.read_only) {
    throw new QueryBudgetError(
      "MIMER_BUD_I04_VIOLATION",
      `${MIMER_BUD_I04}: authorized plan must be read-only`,
    );
  }
  // Policy denials already applied — budget must not re-enable them.
  if (
    authorized.denied_reasons.includes("raw_expansion_denied_by_policy") &&
    authorized.expand_raw
  ) {
    throw new QueryBudgetError(
      "MIMER_BUD_I04_VIOLATION",
      `${MIMER_BUD_I04}: Budget cannot re-enable policy-denied raw expansion`,
    );
  }
}

export function evaluateQueryBudget(input: BudgetEvaluationInput): BudgetEvaluation {
  assertAuthorizedForBudget(input.authorized);

  const policy = input.budget_policy ?? DEFAULT_QUERY_BUDGET_POLICY;
  const estimate = estimateCost(input.metrics, policy);
  const identity_passthrough = Object.freeze({
    ...(input.identity_passthrough ?? {}),
  });

  const baseEvent = {
    estimated_cost: estimate.estimated_cost,
    soft_limit: policy.soft_limit,
    hard_observe_limit: policy.hard_observe_limit,
    policy_version: policy.policy_version,
  };

  input.telemetry?.emit({
    type: "QUERY_BUDGET_ESTIMATED",
    ...baseEvent,
  });

  let status: BudgetEvaluationStatus = "OK";
  let reason: BudgetEvaluation["reason"];

  if (estimate.estimated_cost > policy.hard_observe_limit) {
    status = "PARTIAL";
    reason = "QUERY_BUDGET_OBSERVED_EXCEEDED";
    input.telemetry?.emit({
      type: "QUERY_BUDGET_EXCEEDED",
      ...baseEvent,
      detail: "SOFT mode — continue with warning",
    });
  } else if (estimate.estimated_cost > policy.soft_limit) {
    status = "PARTIAL";
    reason = "QUERY_BUDGET_SOFT_LIMIT";
    input.telemetry?.emit({
      type: "QUERY_BUDGET_WARNING",
      ...baseEvent,
      detail: "SOFT mode — continue",
    });
  }

  if (input.override) {
    input.telemetry?.emit({
      type: "QUERY_BUDGET_OVERRIDE",
      ...baseEvent,
      detail: "Operator override acknowledged; still non-blocking",
    });
  }

  // MIMER-BUD-I03: always continue in v1 (never block).
  return Object.freeze({
    status,
    reason,
    estimate,
    policy,
    authorized_plan: Object.freeze({
      initial_artifact_class: input.authorized.initial_artifact_class,
      expand_evidence: input.authorized.expand_evidence,
      expand_raw: input.authorized.expand_raw,
      policy_version: input.authorized.policy.policy_version,
      denied_reasons: input.authorized.denied_reasons,
    }),
    identity_passthrough,
    continued: true as const,
  });
}
