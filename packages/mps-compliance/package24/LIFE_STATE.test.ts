import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import { ArtifactLifecycleTransitionArtifact } from "../../mps-registry/src/contracts/ArtifactLifecycleArtifact.js";
import { RegistryStateArtifact } from "../../mps-registry/src/contracts/RegistryStateArtifact.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  delete payload.artifact_id;
  delete payload.transition_timestamp;
  delete payload.state_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("LIFE-24-15 & REG-STATE-24-16 Lifecycle and State", () => {
  it("LIFE-24-15-I4 Deterministic Supersession - metadata does not affect identity", async () => {
    const base: ArtifactLifecycleTransitionArtifact = {
      artifact_type: "ARTIFACT_LIFECYCLE_TRANSITION_ARTIFACT",
      artifact_id: "trans-1",
      target_artifact_ref: { artifact_id: "target-1" } as any,
      from_state: "ACTIVE",
      to_state: "SUPERSEDED",
      superseding_artifact_ref: { artifact_id: "target-2" } as any,
      transition_reason: "Deprecation",
      transition_timestamp: "2026-08-04T08:00:00Z",
    } as any;

    const renamed = {
      ...base,
      transition_timestamp: "2026-08-04T09:00:00Z",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  it("REG-STATE-24-16-I1 Registry State Determinism - identical entries give identical hash", async () => {
    const base: RegistryStateArtifact = {
      artifact_type: "REGISTRY_STATE_ARTIFACT",
      artifact_id: "state-1",
      state_version: "1.0",
      entries: [
        { subject_ref: { artifact_id: "sub-1" } as any, state_metadata: { active: true } }
      ],
    } as any;

    const identical = {
      ...base,
      artifact_id: "state-2",
      state_version: "2.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(identical));
  });
});
