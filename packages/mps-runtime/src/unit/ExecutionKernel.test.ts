import { describe, it, expect } from "vitest";
import { ExecutionKernel, sha256ContentHash } from "../kernel/ExecutionKernel.js";
import { FrozenAdmissionAdapter } from "../kernel/FrozenAdmissionAdapter.js";
import { InMemoryArtifactRepository } from "../repository/InMemoryArtifactRepository.js";
import { DefaultReplayEngine } from "../replay/DefaultReplayEngine.js";
import type { FrozenExecutionManifestIdentity } from "../contracts/freeze/FrozenIdentities.js";
import { validateFrozenExecutionOutcomeIdentity } from "../contracts/freeze/FrozenIdentities.js";
import type { CapabilityExecutorPort } from "../kernel/ExecutionKernel.js";

describe("ExecutionKernel", () => {
  it("admits then executes capability and persists attempt/outcome", async () => {
    const repo = new InMemoryArtifactRepository();
    const capabilityExecutor: CapabilityExecutorPort = {
      async execute({ capability_ref, input_refs }) {
        const content_hash = sha256ContentHash({
          cap: capability_ref.artifact_id,
          inputs: input_refs.map((r) => r.artifact_id),
        });
        return {
          artifact_id: `exec-${content_hash.value.slice(0, 8)}`,
          artifact_type: "CAPABILITY_EXECUTION",
          capability_ref,
          input_refs,
          output_refs: [
            { artifact_id: "out-1", artifact_type: "result" },
          ],
          content_hash,
        };
      },
    };

    const kernel = new ExecutionKernel({
      admission: new FrozenAdmissionAdapter(null, true),
      capabilityExecutor,
      artifactRepository: repo,
      replayEngine: new DefaultReplayEngine(repo),
      nowIso: () => "seed:test:1",
    });

    const manifest: FrozenExecutionManifestIdentity = {
      manifest_id: "m-1",
      artifact_type: "execution_manifest",
      execution_identity_ref: {
        artifact_id: "id-1",
        artifact_type: "execution_identity",
      },
      capability_resolution_ref: {
        artifact_id: "cap-res-1",
        artifact_type: "capability_resolution",
      },
      parameters: { deterministic_seed: "seed:test:1" },
      content_hash: sha256ContentHash({ manifest_id: "m-1" }),
    };

    await repo.put({
      artifact_id: manifest.manifest_id,
      content_hash: manifest.content_hash,
      body: manifest,
    });

    const result = await kernel.execute(manifest);
    expect(result.admission.decision).toBe("admitted");
    expect(result.attempt?.content_hash.value).not.toBe("mock-hash");
    expect(result.outcome?.result).toBe("success");
    expect(result.outcome).toMatchObject({
      capability_execution_ref: {
        artifact_id: result.capability_executions[0]?.artifact_id,
        artifact_type: "CAPABILITY_EXECUTION",
      },
    });
    expect(result.capability_executions).toHaveLength(1);

    const replay = await new DefaultReplayEngine(repo).replay(
      { artifact_id: manifest.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );
    expect(replay.artifact_type).toBe("REPLAY");
    expect(replay.equivalence_proof.algorithm).toBe("sha256");

    const outcome = await repo.resolve<typeof result.outcome>(
      result.outcome
        ? { artifact_id: result.outcome.outcome_id, artifact_type: "execution_outcome" }
        : { artifact_id: "missing", artifact_type: "execution_outcome" },
    );
    expect(outcome?.content_hash).toEqual(result.outcome?.content_hash);
    expect(() => validateFrozenExecutionOutcomeIdentity(outcome!)).not.toThrow();

    const replay2 = await new DefaultReplayEngine(repo).replay(
      { artifact_id: manifest.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );
    expect(replay2.content_hash).toEqual(replay.content_hash);
    expect(replay2.equivalence_proof).toEqual(replay.equivalence_proof);
  });

  it("denies when verification context missing and bypass disabled", async () => {
    const repo = new InMemoryArtifactRepository();
    const kernel = new ExecutionKernel({
      admission: new FrozenAdmissionAdapter(null, false),
      capabilityExecutor: {
        async execute() {
          throw new Error("should not run");
        },
      },
      artifactRepository: repo,
      nowIso: () => "seed:x",
    });

    const manifest: FrozenExecutionManifestIdentity = {
      manifest_id: "m-deny",
      artifact_type: "execution_manifest",
      execution_identity_ref: {
        artifact_id: "id-1",
        artifact_type: "execution_identity",
      },
      capability_resolution_ref: {
        artifact_id: "cap-res-1",
        artifact_type: "capability_resolution",
      },
      parameters: {},
      content_hash: sha256ContentHash({ manifest_id: "m-deny" }),
    };

    const result = await kernel.execute(manifest);
    expect(result.admission.decision).toBe("denied");
    expect(result.attempt).toBeNull();
  });
});
