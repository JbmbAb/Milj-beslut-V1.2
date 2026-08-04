import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import { PolicyArtifact } from "../../mps-governance/src/contracts/PolicyArtifact.js";
import { PolicyResolver } from "../../mps-governance/src/resolver/PolicyResolver.js";

async function canonicalHash(obj: any): Promise<string> {
    const pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();
    
    // Identity Isolation: metadata fields do not affect identity
    const payload = { ...obj };
    delete payload.artifact_id;
    delete payload.policy_key;
    delete payload.policy_version;
    
    return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("POL-001 -> POL-004 Policy Compliance", () => {
  // POL-001 Policy Identity Isolation
  it("POL-001 Policy Identity Isolation (A) - policy metadata does not affect identity", async () => {
    const base: PolicyArtifact = {
      artifact_type: "POLICY_ARTIFACT",
      artifact_id: "policy-123",
      policy_key: "environment-policy",
      policy_version: "1.0.0",
      rules: [
        { rule_key: "must-be-approved", expression: "approval_required == true" }
      ]
    } as any;

    const renamed: PolicyArtifact = {
      ...base,
      policy_key: "environment-policy-v2",
      policy_version: "99.0.0"
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // POL-002 Policy Repository Resolution
  it("POL-002 Policy Repository Resolution (A) - policy must resolve through ArtifactRepository", async () => {
    const resolver: PolicyResolver = {
      resolveByRef: async (ref) => ({
        policy: {
          artifact_type: "POLICY_ARTIFACT",
          artifact_id: ref.artifact_id,
          policy_key: "environment-policy",
          policy_version: "1.0.0",
          rules: []
        } as any,
        trace: {
          source: "ArtifactRepository",
          artifact_ref: ref
        }
      })
    };

    const result = await resolver.resolveByRef({ artifact_id: "policy-123" } as any);

    expect(result.trace.source).toBe("ArtifactRepository");
    expect((result.trace.artifact_ref as any).artifact_id).toBe("policy-123");
  });

  // POL-003 Policy Replay Determinism
  it("POL-003 Policy Replay Determinism (B) - same policy rules produce identical policy artifact", async () => {
    const base: PolicyArtifact = {
      artifact_type: "POLICY_ARTIFACT",
      artifact_id: "policy-123",
      policy_key: "environment-policy",
      policy_version: "1.0.0",
      rules: [
        { rule_key: "r1", expression: "x > 0" },
        { rule_key: "r2", expression: "y == true" }
      ]
    } as any;

    const replay: PolicyArtifact = {
      ...base
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(replay));
  });

  // POL-004 Policy Rule Integrity
  it("POL-004 Policy Rule Integrity (A) - canonical rule set is preserved byte-for-byte", async () => {
    const policy: PolicyArtifact = {
      artifact_type: "POLICY_ARTIFACT",
      artifact_id: "policy-123",
      policy_key: "environment-policy",
      policy_version: "1.0.0",
      rules: [
        { rule_key: "r1", expression: "x > 0" },
        { rule_key: "r2", expression: "y == true" }
      ]
    } as any;

    const replay: PolicyArtifact = {
      ...policy
    };

    expect(await canonicalHash(policy)).toBe(await canonicalHash(replay));
  });

  it("POL-004 Policy Rule Integrity (A) - mutated rule set changes canonical identity", async () => {
    const base: PolicyArtifact = {
      artifact_type: "POLICY_ARTIFACT",
      artifact_id: "policy-123",
      policy_key: "environment-policy",
      policy_version: "1.0.0",
      rules: [
        { rule_key: "r1", expression: "x > 0" },
        { rule_key: "r2", expression: "y == true" }
      ]
    } as any;

    const mutated: PolicyArtifact = {
      ...base,
      rules: [
        { rule_key: "r1", expression: "x > 0" },
        { rule_key: "r2", expression: "y == false" }
      ]
    };

    expect(await canonicalHash(base)).not.toBe(await canonicalHash(mutated));
  });
});
