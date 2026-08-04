import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";

/**
 * SignatureEnvelopeArtifact
 *
 * Binds a signature to an exact canonical artifact state.
 */
export interface SignatureEnvelopeArtifact extends ArtifactContract {
  readonly artifact_type: "signature_envelope";

  readonly subject_ref: ArtifactReference;

  /**
   * Exact canonical content hash of the subject at signing time.
   */
  readonly subject_hash: ContentHash;

  readonly profile_ref: ArtifactReference;

  readonly signature_value: string;
}
