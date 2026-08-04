import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";

/**
 * SignatureProfileArtifact
 *
 * Defines allowed signature semantics.
 * Does not perform signing.
 */
export interface SignatureProfileArtifact extends ArtifactContract {
  readonly artifact_type: "signature_profile";

  readonly algorithm: string;
  readonly verification_method: string;
}
