import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import { AuditChainArtifact } from "../../mps-audit/src/contracts/AuditChainArtifact.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  // Identity Isolation
  delete payload.artifact_id;
  delete payload.auditor_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("AUD-24-14 Audit Chain Integration", () => {
  it("AUD-24-14-I1 Canonical Audit Identity - metadata does not affect identity", async () => {
    const base: AuditChainArtifact = {
      artifact_type: "AUDIT_CHAIN_ARTIFACT",
      artifact_id: "chain-1",
      source_ref: { artifact_id: "src-1" } as any,
      ast_ref: { artifact_id: "ast-1" } as any,
      analysis_ref: { artifact_id: "an-1" } as any,
      evaluation_ref: { artifact_id: "eval-1" } as any,
      compliance_ref: { artifact_id: "comp-1" } as any,
      promotion_evaluation_ref: { artifact_id: "pro-eval-1" } as any,
      promotion_decision_ref: { artifact_id: "pro-dec-1" } as any,
      mutation_request_ref: { artifact_id: "mut-req-1" } as any,
      mutation_execution_ref: { artifact_id: "mut-exec-1" } as any,
      previous_registry_state_ref: { artifact_id: "reg-1" } as any,
      next_registry_state_ref: { artifact_id: "reg-2" } as any,
      lineage_refs: [],
      auditor_version: "1.0.0",
    } as any;

    const renamed = {
      ...base,
      auditor_version: "2.0.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });
});
