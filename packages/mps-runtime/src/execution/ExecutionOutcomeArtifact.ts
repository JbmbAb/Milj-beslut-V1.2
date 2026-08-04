import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

export type ExecutionOutcomeStatus = "success" | "failure" | "aborted";

/**
 * ExecutionOutcomeArtifact
 *
 * Deterministic result of an execution attempt.
 */
export interface ExecutionOutcomeArtifact extends ArtifactContract {
  readonly artifact_type: "execution_outcome";

  readonly attempt_ref: ArtifactReference;

  readonly status: ExecutionOutcomeStatus;
  readonly result_code: string;
}
