import { ReplayInvariant, ReplayInvariantResult } from "../ReplayInvariant";
import { CheckpointArtifact } from "../../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../../execution/RuntimeExecutionResult";
import { HashDescriptors } from "../../../types/HashDescriptor";

export const DependencyGraphInvariant: ReplayInvariant = {
  id: "DEPENDENCY_GRAPH_HASH",
  display_name: "Dependency graph hash",
  description: "Dependency graph hash must be identical between original run and replay.",
  severity: "ERROR",

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult {
    const passed = HashDescriptors.equals(
      replay.dependency_resolution.graph_hash as any,
      checkpoint.payload.dependency_graph_hash as any
    );

    return {
      id: "DEPENDENCY_GRAPH_HASH",
      passed,
      severity: "ERROR",
      mismatch: passed
        ? undefined
        : {
            kind: "DEPENDENCY_GRAPH_HASH",
            details: "Dependency graph hash differs between original and replay.",
          },
    };
  },
};
