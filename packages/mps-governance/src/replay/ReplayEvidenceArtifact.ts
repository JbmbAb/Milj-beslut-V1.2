import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * ReplayEvidenceArtifact
 *
 * Records evidence produced during replay for audit.
 */
export interface ReplayEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "replay_evidence";

  readonly replay_ref: ArtifactReference;
  readonly evidence_refs: readonly ArtifactReference[];
}
