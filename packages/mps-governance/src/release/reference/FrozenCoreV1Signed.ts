import { FROZEN_CORE_V1_MANIFEST } from "./FrozenCoreV1";
import { ArtifactContract } from "../../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * SignatureEnvelopeArtifact (mock structure based on ADR-24-22)
 */
export interface SignatureEnvelopeArtifact extends ArtifactContract {
  readonly artifact_type: "signature_envelope";
  readonly subject_ref: ArtifactReference;
  readonly signature_profile_ref: ArtifactReference;
  readonly signature_value: string;
}

export const FROZEN_CORE_V1_SIGNED_MANIFEST = {
  manifest: FROZEN_CORE_V1_MANIFEST,
  signature: {
    artifact_id: "sig-frozen-core-v1",
    artifact_type: "signature_envelope",
    subject_ref: { artifact_id: FROZEN_CORE_V1_MANIFEST.artifact_id, artifact_type: "frozen_core_release_manifest" },
    signature_profile_ref: { artifact_id: "mimer-release-key-profile", artifact_type: "signature_profile" },
    signature_value: "base64-encoded-rsa-mock-signature-of-v1-release"
  } as SignatureEnvelopeArtifact
};
