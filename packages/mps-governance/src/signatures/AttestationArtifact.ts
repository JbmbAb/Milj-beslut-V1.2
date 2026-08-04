import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * AttestationArtifact
 *
 * Actor attests to an existing artifact state.
 */
export interface AttestationArtifact extends ArtifactContract {
  readonly artifact_type: "attestation";

  readonly subject_ref: ArtifactReference;
  readonly actor_ref: ArtifactReference;

  readonly claim: string;
}
