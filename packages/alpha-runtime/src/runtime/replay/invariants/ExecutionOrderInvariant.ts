import { ReplayInvariant, ReplayInvariantResult } from "../ReplayInvariant";
import { CheckpointArtifact } from "../../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../../execution/RuntimeExecutionResult";

export const ExecutionOrderInvariant: ReplayInvariant = {
  id: "COMPLETED_STEPS",
  display_name: "Execution order",
  description: "Completed steps must be identical and in the same order between original run and replay.",
  severity: "ERROR",

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult {
    const a = replay.completed_steps;
    const b = checkpoint.payload.completed_steps;

    const passed = a.length === b.length && a.every((s: string, i: number) => s === b[i]);

    return {
      id: "COMPLETED_STEPS",
      passed,
      severity: "ERROR",
      mismatch: passed
        ? undefined
        : {
            kind: "COMPLETED_STEPS",
            details: "Completed steps / execution order differs between original and replay.",
          },
    };
  },
};
