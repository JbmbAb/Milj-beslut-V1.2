/**
 * QueryBudgetGateway — only accepts already-authorized Decision-first plans.
 * SCALE-I01: Budget MUST NOT become a bypass around Materialization / Retrieval authority.
 */

import type { ArtifactClass } from "../../mps-retrieval-governance/src/ArtifactAccessRules.js";
import { evaluateRetrieval, type RetrievalDecision } from "../../mps-retrieval-governance/src/index.js";
import {
  evaluateQueryBudget,
  type BudgetEvaluation,
  type BudgetEvaluationInput,
} from "./QueryBudgetEvaluator.js";
import { QueryBudgetError } from "./QueryBudgetPolicy.js";

export const SCALE_I01 = "SCALE-I01" as const;

export type BudgetExecuteRequest = {
  readonly artifactClass: ArtifactClass;
  readonly target: "DecisionImpactArtifact" | string;
  readonly intent?: string;
  readonly metrics?: BudgetEvaluationInput["metrics"];
  readonly identity_passthrough?: BudgetEvaluationInput["identity_passthrough"];
};

/**
 * End-to-end gate: RawDocumentChunk → Query Budget → DecisionImpactArtifact is forbidden.
 */
export function executeQueryBudget(request: BudgetExecuteRequest): BudgetEvaluation {
  if (
    request.artifactClass === "RawDocumentChunk" ||
    request.artifactClass === "DocumentChunk"
  ) {
    throw new QueryBudgetError(
      "AUTHORITY_BOUNDARY_VIOLATION",
      `${SCALE_I01}: ${request.artifactClass} cannot enter Query Budget as a path to ${request.target}`,
    );
  }

  if (request.target !== "DecisionImpactArtifact") {
    throw new QueryBudgetError(
      "AUTHORITY_BOUNDARY_VIOLATION",
      `${SCALE_I01}: Query Budget target MUST be DecisionImpactArtifact, got ${request.target}`,
    );
  }

  if (request.artifactClass !== "DecisionImpactArtifact") {
    throw new QueryBudgetError(
      "AUTHORITY_BOUNDARY_VIOLATION",
      `${SCALE_I01}: initial artifactClass MUST be DecisionImpactArtifact`,
    );
  }

  const authorized: RetrievalDecision = evaluateRetrieval({
    intent: request.intent ?? "general analytical query",
    requested_initial: "DecisionImpactArtifact",
  });

  return evaluateQueryBudget({
    authorized,
    metrics: request.metrics ?? {
      artifact_count: 1,
      evidence_expansion_count: 0,
      token_proxy: 0,
      reranker_cost: 0,
    },
    identity_passthrough: request.identity_passthrough,
  });
}
