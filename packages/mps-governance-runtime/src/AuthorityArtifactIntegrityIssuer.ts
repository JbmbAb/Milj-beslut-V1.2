import {
  createArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import type {
  ArtifactReference as PinnedArtifactReference,
  ContentReference,
} from "../../mps-core/src/types.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import type { AuthorityAttestationWriter } from "./DelegationStatusIssuer.js";
import {
  AUTHORITY_ARTIFACT_ATTESTATION_PREDICATE_TYPE,
  AUTHORITY_ARTIFACT_ATTESTATION_SCHEMA_VERSION,
  type AuthorityArtifactAttestationPredicate,
} from "./DefaultAuthorityVerificationPort.js";

export interface IssuedAuthorityArtifactIntegrityEvidence {
  readonly attestation: ArtifactAttestation;
  readonly reference: ContentReference;
}

/**
 * Mints the external integrity attestation consumed by
 * DefaultAuthorityVerificationPort.resolveVerifiedArtifact().
 *
 * This is intentionally separate from authorization semantics: it proves that
 * a trusted signer attested this exact artifact id/type/hash. Whether the actor
 * is authorized for a capability/scope is decided only by the authority closure.
 */
export async function issueAuthorityArtifactIntegrityEvidence(input: {
  readonly artifact_ref: PinnedArtifactReference;
  readonly signing: SigningKeyProvider;
  readonly writer?: AuthorityAttestationWriter;
}): Promise<IssuedAuthorityArtifactIntegrityEvidence> {
  const predicate: AuthorityArtifactAttestationPredicate = {
    artifact_id: input.artifact_ref.artifact_id,
    artifact_type: input.artifact_ref.artifact_type,
    artifact_content_hash: input.artifact_ref.content_hash.digest,
    attestation_schema_version: AUTHORITY_ARTIFACT_ATTESTATION_SCHEMA_VERSION,
    signer_key_id: input.signing.keyId,
  };

  const attestation = await createArtifactAttestation({
    subjectDigest: `sha256:${input.artifact_ref.content_hash.digest}`,
    predicateType: AUTHORITY_ARTIFACT_ATTESTATION_PREDICATE_TYPE,
    predicate: { ...predicate },
    signing: input.signing,
  });

  const contentHash = sha256ContentHash(attestation);
  const reference: ContentReference = {
    id: `authority-artifact-integrity-${contentHash.value}`,
    content_hash: {
      algorithm: contentHash.algorithm,
      digest: contentHash.value,
    },
  };

  if (input.writer) {
    await input.writer.put({
      artifact_id: reference.id,
      content_hash: contentHash,
      body: attestation,
    });
  }

  return { attestation, reference };
}
