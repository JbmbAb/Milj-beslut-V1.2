import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * ExecutionAttemptArtifact
 *
 * Records a concrete attempt to execute a manifest.
 */
export interface ExecutionAttemptArtifact extends ArtifactContract {
  readonly artifact_type: "execution_attempt";

  readonly manifest_ref: ArtifactReference;

  readonly attempt_number: number;
  readonly started_at: string;
}
