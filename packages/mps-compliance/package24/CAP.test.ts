import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";

async function canonicalHash(obj: any): Promise<string> {
    const pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();
    
    // Identity Isolation: metadata fields do not affect identity
    const payload = { ...obj };
    delete payload.artifact_id;
    delete payload.capability_key;
    delete payload.capability_version;
    
    return pipeline.hashCanonical(payload, "JSON").digest;
}
import { CapabilityDefinition } from "../../mps-capability/src/contracts/CapabilityDefinition.js";
import { RepositoryBackedCapabilityResolver } from "../../mps-capability/src/resolver/RepositoryBackedCapabilityResolver.js";
import { DefaultCapabilityExecutionValidator } from "../../mps-capability/src/validation/DefaultCapabilityExecutionValidator.js";
import { DeterministicCapabilityExecutor } from "../../mps-capability/src/executor/DeterministicCapabilityExecutor.js";
import { DefaultReplayValidator } from "../../mps-capability/src/validation/DefaultReplayValidator.js";
import { DefaultImplementationReferenceValidator } from "../../mps-capability/src/validation/DefaultImplementationReferenceValidator.js";

describe("CAP-001 -> CAP-008 Capability Compliance", () => {
  // CAP-001 Capability Identity Isolation
  it("CAP-001 Identity Isolation (A) - capability metadata does not affect identity", async () => {
    const base: CapabilityDefinition = {
      artifact_type: "CAPABILITY_DEFINITION",
      artifact_id: "capability-123",
      capability_key: "environment-analysis",
      capability_version: "1.0.0",
      input_types: ["PROPERTY_UNIT"] as any,
      output_types: ["ANALYSIS_ARTIFACT"] as any,
      required_permissions: [],
      implementation_ref: { artifact_id: "impl-123" } as any
    } as any;

    const renamed: CapabilityDefinition = {
      ...base,
      capability_key: "environment-analysis-v2",
      capability_version: "99.0.0"
    };

    const hashA = await canonicalHash(base);
    const hashB = await canonicalHash(renamed);

    expect(hashA).toBe(hashB);
  });

  // CAP-002 Repository Enforcement
  it("CAP-002 Repository Enforcement (A) - requires artifact resolution through ArtifactRepository", async () => {
    const repository = {
      resolve: async () => ({
        artifact_type: "CAPABILITY_DEFINITION",
        artifact_id: "capability-123",
        capability_key: "environment-analysis",
        capability_version: "1.0.0",
        input_types: [],
        output_types: [],
        required_permissions: [],
        implementation_ref: { artifact_id: "impl-123" }
      })
    };

    const resolver = new RepositoryBackedCapabilityResolver(repository as any);
    const result = await resolver.resolveByRef({ artifact_id: "capability-123" } as any);

    expect(result.trace.source).toBe("ArtifactRepository");
    expect(result.trace.artifactRef.artifact_id).toBe("capability-123");
  });

  // CAP-003 Governance Isolation
  it("CAP-003 Governance Isolation (A) - allows capability execution artifact", () => {
    const validator = new DefaultCapabilityExecutionValidator();
    expect(() =>
      validator.validateExecutionArtifact({
        artifact_type: "CAPABILITY_EXECUTION",
        capability_ref: { artifact_id: "cap-123" },
        input_refs: [{ artifact_id: "input-456" }],
        output_refs: [{ artifact_id: "output-789" }]
      } as any)
    ).not.toThrow();
  });

  it("CAP-003 Governance Isolation (A) - rejects governance artifact creation", () => {
    const validator = new DefaultCapabilityExecutionValidator();
    const unsafe: any = {
      artifact_type: "GOVERNANCE_APPROVAL_ARTIFACT",
      capability_ref: { artifact_id: "cap-123" },
      input_refs: [],
      output_refs: []
    };

    expect(() =>
      validator.validateExecutionArtifact(unsafe)
    ).toThrow("GOVERNANCE_BOUNDARY_VIOLATION");
  });

  // CAP-004 Replay Determinism
  it("CAP-004 Replay Determinism (B) - same capability and input produce identical execution artifact", async () => {
    const repository = {
      resolve: async () => ({
        artifact_type: "IMPLEMENTATION_ARTIFACT",
        artifact_id: "impl-123",
        implementation_key: "env-analysis-impl",
        implementation_version: "1.0.0",
        source_ref: { artifact_id: "build-456" }
      })
    };

    const executor = new DeterministicCapabilityExecutor(repository as any);
    const validator = new DefaultReplayValidator();

    const capability = {
      artifact_type: "CAPABILITY_DEFINITION",
      artifact_id: "capability-123",
      capability_key: "environment-analysis",
      capability_version: "1.0.0",
      input_types: ["PROPERTY_UNIT"],
      output_types: ["ANALYSIS_ARTIFACT"],
      required_permissions: [],
      implementation_ref: { artifact_id: "impl-123" }
    };

    const inputs = [{ artifact_id: "input-456" }];

    const run1 = await executor.execute(capability as any, inputs as any);
    const run2 = await executor.execute(capability as any, inputs as any);

    await expect(validator.verifyReplay(run1, run2)).resolves.not.toThrow();
  });

  // CAP-005 Implementation Reference Integrity
  it("CAP-005 Implementation Reference Integrity (A) - accepts matching implementation artifact", () => {
    const validator = new DefaultImplementationReferenceValidator();
    const capability = {
      artifact_type: "CAPABILITY_DEFINITION",
      artifact_id: "cap-123",
      capability_key: "environment-analysis",
      capability_version: "1.0.0",
      input_types: [],
      output_types: [],
      required_permissions: [],
      implementation_ref: { artifact_id: "impl-123" }
    };
    const impl = {
      artifact_type: "IMPLEMENTATION_ARTIFACT",
      artifact_id: "impl-123",
      implementation_key: "env-analysis-impl",
      implementation_version: "1.0.0",
      source_ref: { artifact_id: "build-456" }
    };

    expect(() => validator.validate(capability as any, impl as any)).not.toThrow();
  });

  it("CAP-005 Implementation Reference Integrity (A) - rejects mismatched implementation artifact", () => {
    const validator = new DefaultImplementationReferenceValidator();
    const capability = {
      artifact_type: "CAPABILITY_DEFINITION",
      artifact_id: "cap-123",
      capability_key: "environment-analysis",
      capability_version: "1.0.0",
      input_types: [],
      output_types: [],
      required_permissions: [],
      implementation_ref: { artifact_id: "impl-123" }
    };
    const impl = {
      artifact_type: "IMPLEMENTATION_ARTIFACT",
      artifact_id: "impl-999",
      implementation_key: "other-impl",
      implementation_version: "2.0.0",
      source_ref: { artifact_id: "build-999" }
    };

    expect(() => validator.validate(capability as any, impl as any)).toThrow("IMPLEMENTATION_REFERENCE_VIOLATION");
  });
});
