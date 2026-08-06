import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

/**
 * Blocking milestone 5.3 — WorkflowOrdering
 * A → B → C never becomes A → C → B.
 */
describe("Workflow verification — WorkflowOrdering (blocking 5.3)", () => {
  it("A→B→C order is stable across runs", async () => {
    const seed = "seed:wf-order";
    const harness = createPlatformHarness({
      snapshot_id: "snap-ord",
      release_id: "rel-ord",
      seed,
      capabilities: [
        {
          artifact_id: "cap-a",
          capability_key: "o.a",
          implementation_id: "impl-a",
          handler: async () => [{ artifact_id: "oa" }],
        },
        {
          artifact_id: "cap-b",
          capability_key: "o.b",
          implementation_id: "impl-b",
          handler: async () => [{ artifact_id: "ob" }],
        },
        {
          artifact_id: "cap-c",
          capability_key: "o.c",
          implementation_id: "impl-c",
          handler: async () => [{ artifact_id: "oc" }],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-abc",
          workflow_key: "order.abc",
          steps: [
            { step_id: "A", capability_id: "cap-a" },
            { step_id: "B", capability_id: "cap-b" },
            { step_id: "C", capability_id: "cap-c" },
          ],
        },
      ],
    });

    const runs = await Promise.all([
      runWorkflowOnce(harness, "wf-abc"),
      runWorkflowOnce(harness, "wf-abc"),
      runWorkflowOnce(harness, "wf-abc"),
    ]);

    for (const run of runs) {
      expect(run.execution.execution_order).toEqual(["A", "B", "C"]);
      expect(run.execution.execution_order).not.toEqual(["A", "C", "B"]);
      expect(run.execution.execution_order.indexOf("A")).toBeLessThan(
        run.execution.execution_order.indexOf("B"),
      );
      expect(run.execution.execution_order.indexOf("B")).toBeLessThan(
        run.execution.execution_order.indexOf("C"),
      );
    }

    expect(runs[0]!.execution.content_hash.value).toBe(
      runs[1]!.execution.content_hash.value,
    );
    expect(runs[1]!.execution.content_hash.value).toBe(
      runs[2]!.execution.content_hash.value,
    );
  });
});
