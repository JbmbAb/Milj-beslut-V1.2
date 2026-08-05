import { describe, it, expect } from "vitest";
import { DefaultReplayEngine } from "../../replay/DefaultReplayEngine.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";

/**
 * Minimal domain fixture — proves Capability Runtime lifecycle without LU.
 * Admit → Capability → Artifacts → Replay
 */
describe("Generality Proof — DummyCapability", () => {
  it("runs Admit → Capability → Artifacts → Replay without domain packages", async () => {
    const seed = "seed:dummy";
    const harness = createPlatformHarness({
      snapshot_id: "snap-dummy",
      release_id: "rel-dummy",
      seed,
      capabilities: [
        {
          artifact_id: "cap-dummy",
          capability_key: "dummy.echo",
          implementation_id: "impl-dummy",
          input_types: ["DUMMY_IN"],
          output_types: ["DUMMY_OUT"],
          handler: async (inputs) => [
            { artifact_id: `dummy-echo-${inputs.length}` },
          ],
        },
      ],
    });

    const manifest = buildManifest({
      manifest_id: "m-dummy",
      capability_id: "cap-dummy",
      seed,
    });
    const { result } = await runCapabilityOnce(harness, manifest);

    expect(result.admission.decision).toBe("admitted");
    expect(result.admission.reason_codes).toContain("SECURITY_ADMIT");
    expect(result.capability_executions).toHaveLength(1);
    expect(result.capability_executions[0]?.output_refs[0]?.artifact_type).toBe(
      "DUMMY_OUT",
    );
    expect(result.outcome?.result).toBe("success");

    const stored = await harness.repo.resolveEnvelope({
      artifact_id: result.capability_executions[0]!.artifact_id,
      artifact_type: "CAPABILITY_EXECUTION",
    });
    expect(stored.content_hash.value).toBe(
      result.capability_executions[0]!.content_hash.value,
    );

    const replay = await new DefaultReplayEngine(harness.repo).replay(
      { artifact_id: manifest.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );
    expect(replay.equivalence_proof.algorithm).toBe("sha256");
    expect(replay.replayed_outcome_ref.artifact_id).toBe(result.outcome!.outcome_id);
  });
});
