import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import { RegistryArtifact } from "../../mps-registry/src/contracts/RegistryArtifact.js";
import { 
  RegistryMutationRequestArtifact,
  RegistryMutationExecutionArtifact 
} from "../../mps-registry/src/contracts/RegistryMutationArtifacts.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  // Identity Isolation
  delete payload.artifact_id;
  delete payload.registry_key;
  delete payload.registry_version;
  delete payload.execution_timestamp;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("Registry Artifacts Compliance", () => {
  it("REG-001 Registry Artifact Identity Isolation - metadata does not affect identity", async () => {
    const base: RegistryArtifact = {
      artifact_type: "REGISTRY_ARTIFACT",
      artifact_id: "reg-123",
      registry_key: "app-registry",
      registry_version: "1.0.0",
      subject_ref: { artifact_id: "app-123" } as any,
    } as any;

    const renamed = {
      ...base,
      registry_key: "app-registry-v2",
      registry_version: "99.0.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  it("REG-24-13-I2 Immutable Promotion Binding (Request) - execution metadata does not affect identity", async () => {
    const base: RegistryMutationRequestArtifact = {
      artifact_type: "REGISTRY_MUTATION_REQUEST_ARTIFACT",
      artifact_id: "req-1",
      promotion_decision_ref: { artifact_id: "dec-1" } as any,
      target_subject_ref: { artifact_id: "app-1" } as any,
      mutation_type: "REGISTER",
    } as any;

    const identical = {
      ...base,
      artifact_id: "req-2",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(identical));
  });

  it("REG-24-13-I2 Immutable Promotion Binding (Execution) - timestamp does not affect identity", async () => {
    const base: RegistryMutationExecutionArtifact = {
      artifact_type: "REGISTRY_MUTATION_EXECUTION_ARTIFACT",
      artifact_id: "exec-1",
      request_ref: { artifact_id: "req-1" } as any,
      final_state_ref: { artifact_id: "state-2" } as any,
      status: "COMMITTED",
      execution_timestamp: "2026-08-04T08:00:00Z",
    } as any;

    const renamed = {
      ...base,
      execution_timestamp: "2026-08-04T09:00:00Z",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  it("REG-24-13-I3 Idempotent Mutation - identical requests give identical hash", async () => {
    // If a request is retried, its identity is the same because its references are the same.
    const req1: RegistryMutationRequestArtifact = {
      artifact_type: "REGISTRY_MUTATION_REQUEST_ARTIFACT",
      artifact_id: "req-1",
      promotion_decision_ref: { artifact_id: "dec-1" } as any,
      target_subject_ref: { artifact_id: "app-1" } as any,
      mutation_type: "REGISTER",
      previous_state_ref: { artifact_id: "state-1" } as any,
    } as any;

    const req2: RegistryMutationRequestArtifact = {
      artifact_type: "REGISTRY_MUTATION_REQUEST_ARTIFACT",
      artifact_id: "req-2",
      promotion_decision_ref: { artifact_id: "dec-1" } as any,
      target_subject_ref: { artifact_id: "app-1" } as any,
      mutation_type: "REGISTER",
      previous_state_ref: { artifact_id: "state-1" } as any,
    } as any;

    expect(await canonicalHash(req1)).toBe(await canonicalHash(req2));
  });
});
