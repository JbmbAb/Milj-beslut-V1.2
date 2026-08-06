import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

describe("Workflow verification — WorkflowReplay", () => {
  it("Workflow → Artifacts → Replay → same content_hash", async () => {
    const seed = "seed:wf-replay-v";
    const harness = createPlatformHarness({
      snapshot_id: "snap-wfr",
      release_id: "rel-wfr",
      seed,
      capabilities: [
        {
          artifact_id: "cap-a",
          capability_key: "r.a",
          implementation_id: "impl-a",
          handler: async (i) => [{ artifact_id: `a-${i[0]?.artifact_id}` }],
        },
        {
          artifact_id: "cap-b",
          capability_key: "r.b",
          implementation_id: "impl-b",
          handler: async (i) => [{ artifact_id: `b-${i[0]?.artifact_id}` }],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-r",
          workflow_key: "r.pipe",
          steps: [
            { step_id: "A", capability_id: "cap-a" },
            { step_id: "B", capability_id: "cap-b" },
          ],
        },
      ],
    });

    const { execution, state } = await runWorkflowOnce(harness, "wf-r", [
      { artifact_id: "in", artifact_type: "IN" },
    ]);
    const { equivalent, replayed } = await harness.workflowRuntime.replay({
      workflow_definition_ref: {
        artifact_id: "wf-r",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [{ artifact_id: "in", artifact_type: "IN" }],
      prior_execution: execution,
      state,
    });
    expect(equivalent).toBe(true);
    expect(replayed.content_hash.value).toBe(execution.content_hash.value);
  });
});
