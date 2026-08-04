import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * ExecutionIdentityArtifact
 *
 * Binds actor trust + signature + capability into a single
 * immutable execution identity.
 */
export interface ExecutionIdentityArtifact extends ArtifactContract {
  readonly artifact_type: "execution_identity";

  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly signature_envelope_ref: ArtifactReference;
}
