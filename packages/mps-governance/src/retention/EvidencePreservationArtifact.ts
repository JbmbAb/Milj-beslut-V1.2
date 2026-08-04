import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * EvidencePreservationArtifact
 *
 * Records preserved evidence according to retention policy.
 */
export interface EvidencePreservationArtifact extends ArtifactContract {
  readonly artifact_type: "evidence_preservation";

  readonly subject_ref: ArtifactReference;
  readonly retention_decision_ref: ArtifactReference;

  readonly preserved_at: string;
}
