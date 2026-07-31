import { ReplayInvariant, ReplayInvariantResult } from "../ReplayInvariant";
import { CheckpointArtifact } from "../../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../../execution/RuntimeExecutionResult";

export const SeedInvariant: ReplayInvariant = {
  id: "DETERMINISTIC_SEED",
  display_name: "Deterministic seed",
  description: "Deterministic seed must be identical between original run and replay.",
  severity: "ERROR",

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult {
    const passed = replay.deterministic_seed === checkpoint.payload.deterministic_seed;

    return {
      id: "DETERMINISTIC_SEED",
      passed,
      severity: "ERROR",
      mismatch: passed
        ? undefined
        : {
            kind: "DETERMINISTIC_SEED",
            details: "Deterministic seed differs between original and replay.",
          },
    };
  },
};
