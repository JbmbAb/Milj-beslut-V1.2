import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";

/**
 * Domain-less multi-step execution — no LU imports, no business rules.
 * Proves Workflow Runtime is generic.
 */
describe("Generality Proof — Synthetic Workflow", () => {
  it("runs multi-step pipeline with deterministic replay (no domain)", async () => {
    const seed = "seed:synthetic-wf";
    const harness = createPlatformHarness({
      snapshot_id: "snap-syn",
      release_id: "rel-syn",
      seed,
      capabilities: [
        {
          artifact_id: "cap-syn-1",
          capability_key: "synthetic.step1",
          implementation_id: "impl-syn-1",
          handler: async (inputs) => [
            { artifact_id: `syn-mid-${inputs[0]?.artifact_id ?? "∅"}` },
          ],
        },
        {
          artifact_id: "cap-syn-2",
          capability_key: "synthetic.step2",
          implementation_id: "impl-syn-2",
          handler: async (inputs) => [
            { artifact_id: `syn-final-${inputs[0]?.artifact_id ?? "∅"}` },
          ],
        },
        {
          artifact_id: "cap-syn-3",
          capability_key: "synthetic.step3",
          implementation_id: "impl-syn-3",
          handler: async (inputs) => [
            { artifact_id: `syn-done-${inputs[0]?.artifact_id ?? "∅"}` },
          ],
        },
      ],
      workflows: [
        {
          artifact_id: "wf-synthetic",
          workflow_key: "synthetic.pipeline",
          steps: [
            { step_id: "ingest", capability_id: "cap-syn-1" },
            { step_id: "transform", capability_id: "cap-syn-2" },
            { step_id: "emit", capability_id: "cap-syn-3" },
          ],
        },
      ],
    });

    const { execution, state } = await runWorkflowOnce(harness, "wf-synthetic", [
      { artifact_id: "syn-seed", artifact_type: "IN" },
    ]);

    expect(execution.execution_order).toEqual(["ingest", "transform", "emit"]);
    expect(execution.execution_refs).toHaveLength(3);

    const { equivalent, replayed } = await harness.workflowRuntime.replay({
      workflow_definition_ref: {
        artifact_id: "wf-synthetic",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [{ artifact_id: "syn-seed", artifact_type: "IN" }],
      prior_execution: execution,
      state,
    });
    expect(equivalent).toBe(true);
    expect(replayed.content_hash.value).toBe(execution.content_hash.value);
  });
});
