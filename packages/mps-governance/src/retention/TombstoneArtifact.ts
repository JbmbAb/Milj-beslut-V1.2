import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * TombstoneArtifact
 *
 * Logical removal marker preserving identity for audit.
 */
export interface TombstoneArtifact extends ArtifactContract {
  readonly artifact_type: "tombstone";

  readonly subject_ref: ArtifactReference;
  readonly retention_decision_ref: ArtifactReference;
}
