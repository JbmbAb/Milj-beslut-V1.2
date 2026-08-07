/**
 * SCALE-I01 — End-to-end negative authority boundary
 * Budget must not become an alternate path around Materialization / Retrieval.
 */
import { describe, expect, it } from "vitest";
import {
  executeQueryBudget,
  QueryBudgetError,
  SCALE_I01,
} from "../src/index.js";

describe("SCALE-I01 End-to-end negative boundary", () => {
  it("RawDocumentChunk → Query Budget → DecisionImpactArtifact is forbidden", () => {
    expect(() =>
      executeQueryBudget({
        artifactClass: "RawDocumentChunk",
        target: "DecisionImpactArtifact",
      }),
    ).toThrow(QueryBudgetError);

    try {
      executeQueryBudget({
        artifactClass: "RawDocumentChunk",
        target: "DecisionImpactArtifact",
      });
    } catch (e) {
      expect((e as QueryBudgetError).code).toBe("AUTHORITY_BOUNDARY_VIOLATION");
      expect((e as QueryBudgetError).message).toContain(SCALE_I01);
    }
  });

  it("DecisionImpactArtifact path is allowed through budget", () => {
    const result = executeQueryBudget({
      artifactClass: "DecisionImpactArtifact",
      target: "DecisionImpactArtifact",
      intent: "general overview",
    });
    expect(result.continued).toBe(true);
    expect(result.authorized_plan.initial_artifact_class).toBe(
      "DecisionImpactArtifact",
    );
  });
});
