import { describe, it, expect } from "vitest";
import { DefaultReplayEngine } from "../../replay/DefaultReplayEngine.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

describe("Architecture Invariant — ReplayDeterminism", () => {
  it("capability path: Execution → Artifacts → Replay → identical hashes", async () => {
    const seed = "seed:replay-cap";
    const harness = createPlatformHarness({
      snapshot_id: "snap-replay",
      release_id: "rel-replay",
      seed,
      capabilities: [
        {
          artifact_id: "cap-r",
          capability_key: "verify.replay",
          implementation_id: "impl-r",
          handler: async () => [{ artifact_id: "finding-r1" }],
        },
      ],
    });
    const manifest = buildManifest({
      manifest_id: "m-replay",
      capability_id: "cap-r",
      seed,
    });
    const { result } = await runCapabilityOnce(harness, manifest);
    expect(result.outcome).not.toBeNull();

    const replayEngine = new DefaultReplayEngine(harness.repo);
    const r1 = await replayEngine.replay(
      { artifact_id: manifest.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );
    const r2 = await replayEngine.replay(
      { artifact_id: manifest.manifest_id, artifact_type: "execution_manifest" },
      result.state,
    );

    expect(r1.content_hash.value).toBe(r2.content_hash.value);
    expect(r1.equivalence_proof.value).toBe(r2.equivalence_proof.value);
    expect(r1.replayed_outcome_ref.artifact_id).toBe(result.outcome!.outcome_id);
  });

  it("workflow path: execute → replay → byte-identical content_hash", async () => {
    const seed = "seed:replay-wf";
    const harness = createPlatformHarness({
      snapshot_id: "snap-wf-replay",
      release_id: "rel-wf-replay",
      seed,
      capabilities: [
        {
          artifact_id: "cap-a",
          capability_key: "verify.a",
          implementation_id: "impl-a",
          handler: async (inputs) => [
            { artifact_id: `mid-${inputs[0]?.artifact_id ?? "x"}` },
          ],
        },
        {
          artifact_id: "cap-b",
          capability_key: "verify.b",
          implementation_id: "impl-b",
          handler: async (inputs) => [
            { artifact_id: `out-${inputs[0]?.artifact_id ?? "x"}` },
          ],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-replay",
          workflow_key: "verify.pipeline",
          steps: [
            { step_id: "A", capability_id: "cap-a" },
            { step_id: "B", capability_id: "cap-b" },
          ],
        },
      ],
    });

    const first = await runWorkflowOnce(harness, "wf-replay", [
      { artifact_id: "seed-in", artifact_type: "IN" },
    ]);
    const replayed = await harness.workflowRuntime.replay({
      workflow_definition_ref: {
        artifact_id: "wf-replay",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [{ artifact_id: "seed-in", artifact_type: "IN" }],
      prior_execution: first.execution,
      state: first.state,
    });

    expect(replayed.equivalent).toBe(true);
    expect(replayed.replayed.content_hash.value).toBe(
      first.execution.content_hash.value,
    );
    expect(replayed.replayed.execution_order).toEqual(["A", "B"]);
  });
});
