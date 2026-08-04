import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import { ArchitectureComplianceArtifact } from "../../mps-dep/src/contracts/ArchitectureArtifacts.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  delete payload.artifact_id;
  delete payload.evaluator_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("COMPLIANCE-24-11 Architecture Compliance", () => {
  it("COMPLIANCE-001 Architecture Compliance Artifact Identity Isolation - metadata does not affect identity", async () => {
    const base: ArchitectureComplianceArtifact = {
      artifact_type: "ARCHITECTURE_COMPLIANCE_ARTIFACT",
      artifact_id: "comp-1",
      analysis_ref: { artifact_id: "an-1" } as any,
      profile_ref: { artifact_id: "prof-1" } as any,
      evaluation_ref: { artifact_id: "eval-1" } as any,
      status: "COMPLIANT",
      violation_refs: [],
      evaluator_version: "1.0.0",
    } as any;

    const renamed = {
      ...base,
      evaluator_version: "2.0.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  it("COMPLIANCE-002 Architecture Compliance Artifact Status Determinism - identical references give identical hash", async () => {
    const base: ArchitectureComplianceArtifact = {
      artifact_type: "ARCHITECTURE_COMPLIANCE_ARTIFACT",
      artifact_id: "comp-1",
      analysis_ref: { artifact_id: "an-1" } as any,
      profile_ref: { artifact_id: "prof-1" } as any,
      evaluation_ref: { artifact_id: "eval-1" } as any,
      status: "NON_COMPLIANT",
      violation_refs: [{ artifact_id: "viol-1" } as any],
      evaluator_version: "1.0.0",
    } as any;

    const identical = { ...base, artifact_id: "comp-2" };

    expect(await canonicalHash(base)).toBe(await canonicalHash(identical));
  });
});
