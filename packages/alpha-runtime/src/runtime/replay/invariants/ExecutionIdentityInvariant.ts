import { ReplayInvariant, ReplayInvariantResult } from "../ReplayInvariant";
import { CheckpointArtifact } from "../../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../../execution/RuntimeExecutionResult";
import { HashDescriptors } from "../../../types/HashDescriptor";

export const ExecutionIdentityInvariant: ReplayInvariant = {
  id: "EXECUTION_IDENTITY_HASH",
  display_name: "Execution identity hash",
  description: "Execution identity hash must be identical between original run and replay.",
  severity: "ERROR",

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult {
    const passed = HashDescriptors.equals(
      replay.execution_identity_hash as any,
      checkpoint.payload.execution_identity_hash as any
    );

    return {
      id: "EXECUTION_IDENTITY_HASH",
      passed,
      severity: "ERROR",
      mismatch: passed
        ? undefined
        : {
            kind: "EXECUTION_IDENTITY_HASH",
            details: "Execution identity hash differs between original and replay.",
          },
    };
  },
};
