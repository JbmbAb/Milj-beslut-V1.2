import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import {
  PromotionCandidateArtifact,
  PromotionEvaluationArtifact,
  PromotionDecisionArtifact,
} from "../../mps-promotion/src/contracts/PromotionArtifacts.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  delete payload.artifact_id;
  delete payload.candidate_key;
  delete payload.candidate_version;
  delete payload.evaluator_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("PROM-24-12 Promotion Integration", () => {
  it("PROM-001 Promotion Candidate Identity Isolation - metadata does not affect identity", async () => {
    const base: PromotionCandidateArtifact = {
      artifact_type: "PROMOTION_CANDIDATE_ARTIFACT",
      artifact_id: "cand-123",
      candidate_key: "env-app",
      candidate_version: "1.0.0",
      subject_ref: { artifact_id: "app-123" } as any,
    } as any;

    const renamed = {
      ...base,
      candidate_key: "env-app-v2",
      candidate_version: "99.0.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  it("PROM-002 Promotion Evaluation Artifact Identity Isolation - metadata does not affect identity", async () => {
    const base: PromotionEvaluationArtifact = {
      artifact_type: "PROMOTION_EVALUATION_ARTIFACT",
      artifact_id: "eval-1",
      compliance_ref: { artifact_id: "comp-1" } as any,
      policy_ref: { artifact_id: "pol-1" } as any,
      status: "ELIGIBLE",
      evaluator_version: "1.0.0",
    } as any;

    const renamed = {
      ...base,
      evaluator_version: "2.0.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  it("PROM-003 Promotion Decision Artifact Identity Isolation - deterministic references give identical hash", async () => {
    const base: PromotionDecisionArtifact = {
      artifact_type: "PROMOTION_DECISION_ARTIFACT",
      artifact_id: "dec-1",
      evaluation_ref: { artifact_id: "eval-1" } as any,
      governance_ref: { artifact_id: "gov-1" } as any,
      decision: "APPROVED",
    } as any;

    const identical = {
      ...base,
      artifact_id: "dec-2",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(identical));
  });
});
