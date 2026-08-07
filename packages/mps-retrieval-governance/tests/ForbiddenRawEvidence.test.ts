/**
 * Forbidden Raw Evidence paths
 */
import { describe, expect, it } from "vitest";
import {
  assertArtifactClassAllowed,
  buildRetrievalPolicy,
  evaluateRetrieval,
  RetrievalGovernanceError,
} from "../src/index.js";

describe("ForbiddenRawEvidence", () => {
  it("DECISION_SUMMARY forbids RawDocumentChunk", () => {
    const policy = buildRetrievalPolicy("DECISION_SUMMARY");
    expect(policy.access.forbidden).toContain("RawDocumentChunk");
    expect(policy.allow_raw_expansion).toBe(false);
    expect(() =>
      assertArtifactClassAllowed(policy, "RawDocumentChunk"),
    ).toThrow(RetrievalGovernanceError);
  });

  it("GENERAL query cannot expand to raw", () => {
    const decision = evaluateRetrieval({
      intent: "general overview",
      expand_raw: true,
      expand_evidence: true,
    });
    expect(decision.expand_raw).toBe(false);
    expect(decision.denied_reasons).toContain("raw_expansion_denied_by_policy");
  });

  it("PROVENANCE_AUDIT may expand raw only after DecisionImpact", () => {
    const decision = evaluateRetrieval({
      intent: "provenance audit of underlag",
      expand_evidence: true,
      expand_raw: true,
    });
    expect(decision.initial_artifact_class).toBe("DecisionImpactArtifact");
    expect(decision.expand_raw).toBe(true);
    expect(decision.policy.query_type).toBe("PROVENANCE_AUDIT");
  });
});
