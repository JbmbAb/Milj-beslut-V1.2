/**
 * Decision Knowledge Retrieval Contract — FROZEN
 *
 * Executable form of MIMER-SCALE-I01 (ADR-29).
 *
 * Allowed:
 *   GENERAL QUERY → DecisionImpactArtifact → (optional) EvidenceSet → (optional) Raw Evidence
 *
 * Forbidden:
 *   GENERAL QUERY → Raw Evidence
 *
 * Invariant:
 *   Raw Evidence SHALL NOT be the initial retrieval target for analytical queries.
 *   AI MUST NOT use raw material as the primary knowledge source as data volume grows.
 *
 * @see docs/architecture/ADR-29-Intelligence-Projection-Boundary.md
 */

export const DECISION_RETRIEVAL_CONTRACT_VERSION = "1" as const;

/** Retrieval stages — ordered from cheapest/distilled to raw. */
export type RetrievalStage =
  | "DECISION_IMPACT"
  | "EVIDENCE_SET"
  | "RAW_EVIDENCE";

export type AnalyticalQuery = {
  readonly intent: string;
  readonly jurisdiction_level?: string;
  readonly decision_type?: string;
  readonly municipality_code?: string;
  readonly county_code?: string;
  readonly period_start?: string;
  readonly period_end?: string;
};

/**
 * Frozen pipeline: initial target MUST be DecisionImpact.
 * Expansion is optional and planner-driven.
 */
export type DecisionRetrievalPlan = {
  readonly contract_version: typeof DECISION_RETRIEVAL_CONTRACT_VERSION;
  readonly query: AnalyticalQuery;
  /** Always DECISION_IMPACT for analytical queries (MIMER-SCALE-I01). */
  readonly initial_stage: "DECISION_IMPACT";
  readonly expand_to_evidence_sets: boolean;
  readonly expand_to_raw_evidence: boolean;
  readonly max_decision_impacts: number;
  readonly max_evidence_sets: number;
  readonly max_raw_documents: number;
};

export type DecisionRetrievalResult = {
  readonly plan: DecisionRetrievalPlan;
  readonly decision_impact_ids: readonly string[];
  readonly evidence_set_hashes: readonly string[];
  readonly document_hashes: readonly string[];
  readonly stages_used: readonly RetrievalStage[];
};

export class DecisionRetrievalContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DecisionRetrievalContractError";
  }
}

/**
 * MIMER-SCALE-I01 — Raw Evidence / DocumentChunk SHALL NOT be the initial
 * retrieval target for analytical queries.
 */
export function assertAnalyticalRetrievalContract(
  plan: DecisionRetrievalPlan,
): void {
  if (plan.contract_version !== DECISION_RETRIEVAL_CONTRACT_VERSION) {
    throw new DecisionRetrievalContractError(
      "RETRIEVAL_CONTRACT_VERSION_MISMATCH",
      `Expected contract_version ${DECISION_RETRIEVAL_CONTRACT_VERSION}, got ${plan.contract_version}`,
    );
  }

  const initial = plan.initial_stage as string;
  // Constitutional: only DecisionImpact may be the analytical entry point.
  // DocumentChunk / RAW_EVIDENCE / any other stage is an MIMER-SCALE-I01 violation.
  if (initial !== "DECISION_IMPACT") {
    throw new DecisionRetrievalContractError(
      "MIMER_SCALE_I01_VIOLATION",
      "Raw Evidence / DocumentChunk SHALL NOT be the initial retrieval target for analytical queries",
    );
  }

  if (plan.expand_to_raw_evidence && !plan.expand_to_evidence_sets) {
    throw new DecisionRetrievalContractError(
      "MIMER_SCALE_I01_VIOLATION",
      "Raw Evidence expansion requires EvidenceSet stage (no skip from DecisionImpact → Raw)",
    );
  }

  if (plan.max_decision_impacts < 1) {
    throw new DecisionRetrievalContractError(
      "RETRIEVAL_PLAN_INVALID",
      "max_decision_impacts must be >= 1",
    );
  }
}

export function createDecisionRetrievalPlan(
  query: AnalyticalQuery,
  options?: {
    readonly expand_to_evidence_sets?: boolean;
    readonly expand_to_raw_evidence?: boolean;
    readonly max_decision_impacts?: number;
    readonly max_evidence_sets?: number;
    readonly max_raw_documents?: number;
  },
): DecisionRetrievalPlan {
  const plan: DecisionRetrievalPlan = {
    contract_version: DECISION_RETRIEVAL_CONTRACT_VERSION,
    query,
    initial_stage: "DECISION_IMPACT",
    expand_to_evidence_sets: options?.expand_to_evidence_sets ?? false,
    expand_to_raw_evidence: options?.expand_to_raw_evidence ?? false,
    max_decision_impacts: options?.max_decision_impacts ?? 20,
    max_evidence_sets: options?.max_evidence_sets ?? 10,
    max_raw_documents: options?.max_raw_documents ?? 50,
  };
  assertAnalyticalRetrievalContract(plan);
  return Object.freeze(plan);
}
