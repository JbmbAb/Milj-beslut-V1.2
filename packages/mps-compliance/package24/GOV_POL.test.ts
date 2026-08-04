import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import { PolicyArtifact } from "../../mps-governance/src/contracts/PolicyArtifact.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  delete payload.artifact_id;
  delete payload.governance_key;
  delete payload.governance_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("GOV-POL-24-17 Governance Policy Scoping", () => {
  it("GOV-POL-17-I5 Policy Scope Binding - identical scope gives identical identity", async () => {
    const base: PolicyArtifact = {
      artifact_type: "POLICY_ARTIFACT",
      artifact_id: "pol-1",
      governance_key: "sec-pol",
      governance_version: "1.0",
      subject_ref: { artifact_id: "sys-1" } as any,
      policy_scope: {
        applicable_domain: "security",
        applicable_artifact_types: ["DEPENDENCY_ARTIFACT"],
        effective_version_range: ">=1.0.0",
      }
    } as any;

    const renamed = {
      ...base,
      governance_version: "2.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });
});
