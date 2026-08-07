/**
 * MIMER-RET-I01 / Retrieval boundary
 */
import { describe, expect, it } from "vitest";
import {
  evaluateRetrieval,
  MIMER_RET_I01,
  RetrievalGovernanceError,
} from "../src/index.js";

describe("RetrievalBoundary", () => {
  it("MIMER-RET-I01: general query resolves DecisionImpactArtifact first", () => {
    const decision = evaluateRetrieval({
      intent: "Visa utvecklingen av avloppsärenden i Värmland",
    });
    expect(decision.initial_artifact_class).toBe("DecisionImpactArtifact");
    expect(decision.policy.access.initial).toBe("DecisionImpactArtifact");
    expect(decision.read_only).toBe(true);
  });

  it("forbids DocumentChunk / RawDocumentChunk as initial target", () => {
    for (const requested_initial of ["DocumentChunk", "RawDocumentChunk"] as const) {
      expect(() =>
        evaluateRetrieval({
          intent: "general analytical query",
          requested_initial,
        }),
      ).toThrow(RetrievalGovernanceError);
      try {
        evaluateRetrieval({
          intent: "general analytical query",
          requested_initial,
        });
      } catch (e) {
        expect((e as RetrievalGovernanceError).code).toBe("MIMER_RET_I01_VIOLATION");
        expect((e as RetrievalGovernanceError).message).toContain(MIMER_RET_I01);
      }
    }
  });

  it("MIMER-RET-I03: retrieval is read-only (cannot create authority)", () => {
    const decision = evaluateRetrieval({ intent: "summary of decision" });
    expect(decision.read_only).toBe(true);
    // Side-effect free: evaluating twice does not write (no throw from authority).
    expect(() => evaluateRetrieval({ intent: "summary of decision" })).not.toThrow();
  });
});
