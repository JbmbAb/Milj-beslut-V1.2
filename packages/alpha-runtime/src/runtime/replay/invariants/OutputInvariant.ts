import { ReplayInvariant, ReplayInvariantResult } from "../ReplayInvariant";
import { CheckpointArtifact } from "../../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../../execution/RuntimeExecutionResult";
import {
  RegistryReferenceCanonicalizer,
} from "../../canonicalization/RegistryReferenceCanonicalizer";

export const OutputInvariant: ReplayInvariant = {
  id: "OUTPUT_ARTIFACTS",
  display_name: "Output artifacts",
  description: "Output artifacts (logical_id, version, content_hash) must match between original run and replay.",
  severity: "ERROR",

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult {
    const replayCanonical = replay.output_references
      .map(RegistryReferenceCanonicalizer.toCanonical)
      .sort(RegistryReferenceCanonicalizer.compare);

    const originalCanonical = checkpoint.payload.produced_outputs
      .map(RegistryReferenceCanonicalizer.toCanonical)
      .sort(RegistryReferenceCanonicalizer.compare);

    const passed =
      replayCanonical.length === originalCanonical.length &&
      replayCanonical.every((r: any, i: number) =>
        r.logical_id === originalCanonical[i].logical_id &&
        r.version === originalCanonical[i].version &&
        r.content_hash === originalCanonical[i].content_hash
      );

    return {
      id: "OUTPUT_ARTIFACTS",
      passed,
      severity: "ERROR",
      mismatch: passed
        ? undefined
        : {
            kind: "OUTPUT_ARTIFACTS",
            details: "Output artifacts differ between original and replay.",
          },
    };
  },
};
