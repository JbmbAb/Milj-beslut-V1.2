import { describe, it, expect } from "vitest";
import {
  createPlatformHarness,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";
import { WorkflowStepError } from "../../workflow/WorkflowRuntime.js";
import { createEmptyRuntimeState } from "../../kernel/RuntimeState.js";

describe("Workflow verification — FailureRecovery", () => {
  it("step 4 crash → resume continues from step 4, not step 1", async () => {
    const seed = "seed:wf-fail";
    let step4Attempts = 0;
    const calls: string[] = [];

    const harness = createPlatformHarness({
      snapshot_id: "snap-fail",
      release_id: "rel-fail",
      seed,
      capabilities: [
        {
          artifact_id: "cap-1",
          capability_key: "f.1",
          implementation_id: "impl-1",
          handler: async () => {
            calls.push("1");
            return [{ artifact_id: "o1" }];
          },
        },
        {
          artifact_id: "cap-2",
          capability_key: "f.2",
          implementation_id: "impl-2",
          handler: async () => {
            calls.push("2");
            return [{ artifact_id: "o2" }];
          },
        },
        {
          artifact_id: "cap-3",
          capability_key: "f.3",
          implementation_id: "impl-3",
          handler: async () => {
            calls.push("3");
            return [{ artifact_id: "o3" }];
          },
        },
        {
          artifact_id: "cap-4",
          capability_key: "f.4",
          implementation_id: "impl-4",
          handler: async () => {
            calls.push("4");
            step4Attempts += 1;
            if (step4Attempts === 1) {
              throw new Error("simulated crash at step 4");
            }
            return [{ artifact_id: "o4" }];
          },
        },
        {
          artifact_id: "cap-5",
          capability_key: "f.5",
          implementation_id: "impl-5",
          handler: async () => {
            calls.push("5");
            return [{ artifact_id: "o5" }];
          },
        },
      ],
      workflows: [
        {
          artifact_id: "wf-fail",
          workflow_key: "fail.pipeline",
          steps: [
            { step_id: "s1", capability_id: "cap-1" },
            { step_id: "s2", capability_id: "cap-2" },
            { step_id: "s3", capability_id: "cap-3" },
            { step_id: "s4", capability_id: "cap-4" },
            { step_id: "s5", capability_id: "cap-5" },
          ],
        },
      ],
    });

    const state = createEmptyRuntimeState();
    let checkpoint = null as import("../../workflow/WorkflowRuntime.js").WorkflowCheckpoint | null;

    try {
      await harness.workflowRuntime.execute({
        workflow_definition_ref: {
          artifact_id: "wf-fail",
          artifact_type: "WORKFLOW_DEFINITION",
        },
        input_refs: [{ artifact_id: "in", artifact_type: "IN" }],
        state,
      });
      expect.fail("expected WorkflowStepError");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowStepError);
      checkpoint = (err as WorkflowStepError).checkpoint;
    }

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.failed_step_id).toBe("s4");
    expect(checkpoint!.completed_step_ids).toEqual(["s1", "s2", "s3"]);
    expect(calls).toEqual(["1", "2", "3", "4"]);

    const callsBeforeResume = [...calls];
    const completed = await harness.workflowRuntime.resume({
      workflow_definition_ref: {
        artifact_id: "wf-fail",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [{ artifact_id: "in", artifact_type: "IN" }],
      checkpoint: checkpoint!,
      state,
    });

    expect(completed.execution_order).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    // Steps 1–3 must NOT re-run; only 4 (retry) and 5
    expect(calls.slice(callsBeforeResume.length)).toEqual(["4", "5"]);
    expect(step4Attempts).toBe(2);

    // Full clean run for comparison of final order (hashes differ because crash path
    // reuses first-pass capability execution ids for steps 1–3)
    const clean = await runWorkflowOnce(harness, "wf-fail", [
      { artifact_id: "in", artifact_type: "IN" },
    ]);
    expect(clean.execution.execution_order).toEqual(completed.execution_order);
  });
});
