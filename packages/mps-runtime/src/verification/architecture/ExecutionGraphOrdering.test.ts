import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";
import { ObservabilityRuntime } from "../../observability/index.js";

describe("Architecture Invariant — ExecutionGraphOrdering", () => {
  it("steps A→B→C never reorder to B→A", async () => {
    const seed = "seed:graph-order";
    const harness = createPlatformHarness({
      snapshot_id: "snap-order",
      release_id: "rel-order",
      seed,
      capabilities: [
        {
          artifact_id: "cap-a",
          capability_key: "verify.a",
          implementation_id: "impl-a",
          handler: async () => [{ artifact_id: "out-a" }],
        },
        {
          artifact_id: "cap-b",
          capability_key: "verify.b",
          implementation_id: "impl-b",
          handler: async () => [{ artifact_id: "out-b" }],
        },
        {
          artifact_id: "cap-c",
          capability_key: "verify.c",
          implementation_id: "impl-c",
          handler: async () => [{ artifact_id: "out-c" }],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-abc",
          workflow_key: "verify.abc",
          steps: [
            { step_id: "A", capability_id: "cap-a" },
            { step_id: "B", capability_id: "cap-b" },
            { step_id: "C", capability_id: "cap-c" },
          ],
        },
      ],
    });

    const { execution } = await runWorkflowOnce(harness, "wf-abc");
    expect(execution.execution_order).toEqual(["A", "B", "C"]);
    expect(execution.execution_order).not.toEqual(["B", "A", "C"]);
    expect(execution.execution_order.indexOf("A")).toBeLessThan(
      execution.execution_order.indexOf("B"),
    );
    expect(execution.execution_order.indexOf("B")).toBeLessThan(
      execution.execution_order.indexOf("C"),
    );

    const bundle = ObservabilityRuntime.create().collectFromWorkflowExecution({
      workflow_execution: execution,
    });
    expect(bundle.execution_graph.nodes.map((n) => n.node_id)).toEqual([
      "wf-step-A",
      "wf-step-B",
      "wf-step-C",
    ]);
    expect(bundle.execution_graph.edges).toEqual([
      { from: "wf-step-A", to: "wf-step-B" },
      { from: "wf-step-B", to: "wf-step-C" },
    ]);
  });
});
