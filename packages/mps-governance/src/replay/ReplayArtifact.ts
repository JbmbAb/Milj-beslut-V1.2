import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * ReplayArtifact
 *
 * Describes deterministic replay of a prior execution.
 */
export interface ReplayArtifact extends ArtifactContract {
  readonly artifact_type: "replay";

  readonly original_execution_identity_ref: ArtifactReference;
  readonly original_manifest_ref: ArtifactReference;
  readonly original_outcome_ref: ArtifactReference;
}
