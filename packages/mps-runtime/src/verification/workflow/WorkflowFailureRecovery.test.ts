import { describe, it, expect } from "vitest";
import { WorkflowStepError } from "../../workflow/WorkflowRuntime.js";
import type { WorkflowCheckpoint } from "../../workflow/WorkflowRuntime.js";
import { createEmptyRuntimeState } from "../../kernel/RuntimeState.js";
import { createPlatformHarness } from "../harness/PlatformHarness.js";

/**
 * Blocking milestone 5.1 — WorkflowFailureRecovery
 *
 * Step 1 ✓ → Step 2 ✓ → Step 3 CRASH → Restart → Step 3 continues (not Step 1)
 *
 * Proves: execution_order preserved, completed artifacts reused,
 * no new identities for completed steps, no duplicate capability runs.
 */
describe("Workflow verification — FailureRecovery (blocking 5.1)", () => {
  it("crash at step 3 → resume reuses steps 1–2 artifacts and does not re-run them", async () => {
    const seed = "seed:wf-fail-3";
    let step3Attempts = 0;
    const calls: string[] = [];

    const harness = createPlatformHarness({
      snapshot_id: "snap-fail-3",
      release_id: "rel-fail-3",
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
            step3Attempts += 1;
            if (step3Attempts === 1) {
              throw new Error("simulated crash at step 3");
            }
            return [{ artifact_id: "o3" }];
          },
        },
        {
          artifact_id: "cap-4",
          capability_key: "f.4",
          implementation_id: "impl-4",
          handler: async () => {
            calls.push("4");
            return [{ artifact_id: "o4" }];
          },
        },
      ],
      workflows: [
        {
          artifact_id: "wf-fail-3",
          workflow_key: "fail.at3",
          steps: [
            { step_id: "s1", capability_id: "cap-1" },
            { step_id: "s2", capability_id: "cap-2" },
            { step_id: "s3", capability_id: "cap-3" },
            { step_id: "s4", capability_id: "cap-4" },
          ],
        },
      ],
    });

    const state = createEmptyRuntimeState();
    let checkpoint: WorkflowCheckpoint | null = null;

    try {
      await harness.workflowRuntime.execute({
        workflow_definition_ref: {
          artifact_id: "wf-fail-3",
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
    expect(checkpoint!.failed_step_id).toBe("s3");
    expect(checkpoint!.completed_step_ids).toEqual(["s1", "s2"]);
    expect(checkpoint!.execution_refs).toHaveLength(2);
    expect(calls).toEqual(["1", "2", "3"]);

    const preservedRefs = checkpoint!.execution_refs.map((r) => r.artifact_id);
    const preservedOrder = [...checkpoint!.completed_step_ids];
    const callsAtCrash = [...calls];

    const completed = await harness.workflowRuntime.resume({
      workflow_definition_ref: {
        artifact_id: "wf-fail-3",
        artifact_type: "WORKFLOW_DEFINITION",
      },
      input_refs: [{ artifact_id: "in", artifact_type: "IN" }],
      checkpoint: checkpoint!,
      state,
    });

    // execution_order bevaras (prefix + fortsatt kedja)
    expect(completed.execution_order.slice(0, 2)).toEqual(preservedOrder);
    expect(completed.execution_order).toEqual(["s1", "s2", "s3", "s4"]);

    // Artifacts återanvänds — samma identity för completed steps
    expect(completed.execution_refs[0]?.artifact_id).toBe(preservedRefs[0]);
    expect(completed.execution_refs[1]?.artifact_id).toBe(preservedRefs[1]);
    expect(completed.execution_refs.slice(0, 2)).toEqual(
      checkpoint!.execution_refs,
    );

    // Inga dubbla capability-körningar för steg 1–2; endast retry av 3 + 4
    expect(calls.slice(0, 3)).toEqual(callsAtCrash);
    expect(calls.filter((c) => c === "1")).toHaveLength(1);
    expect(calls.filter((c) => c === "2")).toHaveLength(1);
    expect(calls.slice(callsAtCrash.length)).toEqual(["3", "4"]);
    expect(step3Attempts).toBe(2);

    // Inga nya identities för completed prefix
    expect(new Set(completed.execution_refs.map((r) => r.artifact_id)).size).toBe(
      completed.execution_refs.length,
    );
  });
});
