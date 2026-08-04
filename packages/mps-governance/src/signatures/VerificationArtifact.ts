import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * VerificationArtifact
 *
 * Records deterministic verification execution.
 */
export interface VerificationArtifact extends ArtifactContract {
  readonly artifact_type: "verification";

  readonly subject_ref: ArtifactReference;
  readonly verifier_ref: ArtifactReference;
}
