import { CheckpointArtifact } from "../checkpoint/CheckpointArtifact";
import { RuntimeExecutionResult } from "../execution/RuntimeExecutionResult";
import { ReplayMismatch, ReplayMismatchKind } from "./ReplayVerifierTypes";

export type ReplayInvariantSeverity = "INFO" | "WARNING" | "ERROR" | "FATAL";

export interface ReplayInvariantResult {
  readonly id: ReplayMismatchKind;
  readonly passed: boolean;
  readonly mismatch?: ReplayMismatch;
  readonly severity: ReplayInvariantSeverity;
}

export interface ReplayInvariant {
  readonly id: ReplayMismatchKind;
  readonly display_name: string;
  readonly description: string;
  readonly severity: ReplayInvariantSeverity;

  verify(
    checkpoint: CheckpointArtifact,
    replay: RuntimeExecutionResult
  ): ReplayInvariantResult;
}
