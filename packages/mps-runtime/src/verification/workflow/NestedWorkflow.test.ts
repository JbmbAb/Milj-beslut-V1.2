import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

describe("Workflow verification — NestedWorkflow", () => {
  it("parent workflow invokes child workflow as a step", async () => {
    const seed = "seed:nested";
    const harness = createPlatformHarness({
      snapshot_id: "snap-nest",
      release_id: "rel-nest",
      seed,
      capabilities: [
        {
          artifact_id: "cap-inner-a",
          capability_key: "inner.a",
          implementation_id: "impl-ia",
          handler: async (inputs) => [
            { artifact_id: `inner-a-${inputs[0]?.artifact_id ?? "x"}` },
          ],
        },
        {
          artifact_id: "cap-inner-b",
          capability_key: "inner.b",
          implementation_id: "impl-ib",
          handler: async (inputs) => [
            { artifact_id: `inner-b-${inputs[0]?.artifact_id ?? "x"}` },
          ],
        },
        {
          artifact_id: "cap-outer",
          capability_key: "outer.fin",
          implementation_id: "impl-o",
          handler: async (inputs) => [
            { artifact_id: `outer-${inputs[0]?.artifact_id ?? "x"}` },
          ],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-child",
          workflow_key: "nested.child",
          steps: [
            { step_id: "ca", capability_id: "cap-inner-a" },
            { step_id: "cb", capability_id: "cap-inner-b" },
          ],
        },
        {
          artifact_id: "wf-parent",
          workflow_key: "nested.parent",
          steps: [
            { step_id: "run_child", workflow_id: "wf-child" },
            { step_id: "finish", capability_id: "cap-outer" },
          ],
        },
      ],
    });

    const { execution } = await runWorkflowOnce(harness, "wf-parent", [
      { artifact_id: "seed", artifact_type: "IN" },
    ]);

    expect(execution.execution_order).toEqual(["run_child", "finish"]);
    expect(execution.execution_refs[0]?.artifact_type).toBe("WORKFLOW_EXECUTION");
    expect(execution.execution_refs[1]?.artifact_type).toBe("CAPABILITY_EXECUTION");

    const { execution: second } = await runWorkflowOnce(harness, "wf-parent", [
      { artifact_id: "seed", artifact_type: "IN" },
    ]);
    expect(second.content_hash.value).toBe(execution.content_hash.value);
  });
});
