import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

describe("Workflow verification — ParallelCapability", () => {
  it("two parallel capabilities → deterministic merge order and hash", async () => {
    const seed = "seed:parallel";
    const harness = createPlatformHarness({
      snapshot_id: "snap-par",
      release_id: "rel-par",
      seed,
      capabilities: [
        {
          artifact_id: "cap-left",
          capability_key: "par.left",
          implementation_id: "impl-left",
          handler: async () => [{ artifact_id: "out-left" }],
        },
        {
          artifact_id: "cap-right",
          capability_key: "par.right",
          implementation_id: "impl-right",
          handler: async () => [{ artifact_id: "out-right" }],
        },
        {
          artifact_id: "cap-join",
          capability_key: "par.join",
          implementation_id: "impl-join",
          handler: async (inputs) => [
            {
              artifact_id: `joined-${inputs.map((i) => i.artifact_id).join("+")}`,
            },
          ],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-par",
          workflow_key: "par.pipeline",
          steps: [
            // Declared right-then-left; runtime sorts by step_id → left then right
            {
              step_id: "right",
              capability_id: "cap-right",
              parallel_group: "fan",
            },
            {
              step_id: "left",
              capability_id: "cap-left",
              parallel_group: "fan",
            },
            { step_id: "join", capability_id: "cap-join" },
          ],
        },
      ],
    });

    const a = await runWorkflowOnce(harness, "wf-par", [
      { artifact_id: "seed", artifact_type: "IN" },
    ]);
    const b = await runWorkflowOnce(harness, "wf-par", [
      { artifact_id: "seed", artifact_type: "IN" },
    ]);

    expect(a.execution.execution_order).toEqual(["left", "right", "join"]);
    expect(b.execution.execution_order).toEqual(["left", "right", "join"]);
    expect(a.execution.content_hash.value).toBe(b.execution.content_hash.value);
    expect(a.execution.execution_refs).toHaveLength(3);
  });
});
