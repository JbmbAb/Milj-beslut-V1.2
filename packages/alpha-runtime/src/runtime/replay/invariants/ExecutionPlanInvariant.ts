import { ReplayInvariant, ReplayInvariantResult } from "../ReplayInvariant";
import { CheckpointArtifact } from "../../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../../execution/RuntimeExecutionResult";
import { HashDescriptors } from "../../../types/HashDescriptor";

export const ExecutionPlanInvariant: ReplayInvariant = {
  id: "EXECUTION_PLAN_HASH",
  display_name: "Execution plan hash",
  description: "Execution plan hash must be identical between original run and replay.",
  severity: "ERROR",

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult {
    const passed = HashDescriptors.equals(
      replay.execution_plan_hash as any,
      checkpoint.payload.execution_plan_hash as any
    );

    return {
      id: "EXECUTION_PLAN_HASH",
      passed,
      severity: "ERROR",
      mismatch: passed
        ? undefined
        : {
            kind: "EXECUTION_PLAN_HASH",
            details: "Execution plan hash differs between original and replay.",
          },
    };
  },
};
