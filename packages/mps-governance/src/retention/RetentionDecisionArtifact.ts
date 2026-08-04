import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * RetentionDecisionArtifact
 *
 * Records a retention decision for a subject artifact.
 */
export interface RetentionDecisionArtifact extends ArtifactContract {
  readonly artifact_type: "retention_decision";

  readonly subject_ref: ArtifactReference;
  readonly policy_ref: ArtifactReference;

  readonly decision: "retain" | "expire";
  readonly decided_at: string;
}
