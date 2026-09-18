import {
  createArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import type {
  ArtifactReference as PinnedArtifactReference,
  ContentReference,
} from "../../mps-core/src/types.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import {
  DELEGATION_STATUS_PREDICATE_TYPE,
  DELEGATION_STATUS_SCHEMA_VERSION,
  type DelegationStatus,
  type DelegationStatusPredicate,
} from "./AuthorityVerification.js";

export interface AuthorityAttestationWriter {
  put(artifact: {
    readonly artifact_id: string;
    readonly content_hash: ContentHash;
    readonly body: unknown;
  }): Promise<void>;
}

export interface IssuedDelegationStatusEvidence {
  readonly attestation: ArtifactAttestation;
  readonly reference: ContentReference;
}

/**
 * Authority-side minting path for the evidence consumed by
 * verifyAuthorityAtDecisionTime().
 *
 * Verification runtimes receive only the persisted attestation + public-key
 * keyring; signing capability stays outside the verifier.
 */
export async function issueDelegationStatusEvidence(input: {
  readonly delegation_ref: PinnedArtifactReference;
  readonly status: DelegationStatus;
  readonly evaluated_at: string;
  readonly revoked_at?: string;
  readonly signing: SigningKeyProvider;
  readonly writer?: AuthorityAttestationWriter;
}): Promise<IssuedDelegationStatusEvidence> {
  const evaluatedMs = Date.parse(input.evaluated_at);
  if (Number.isNaN(evaluatedMs)) {
    throw new Error("REJECT_DELEGATION_STATUS_ISSUE: invalid evaluated_at");
  }

  if (input.status === "ACTIVE" && input.revoked_at !== undefined) {
    throw new Error("REJECT_DELEGATION_STATUS_ISSUE: ACTIVE cannot carry revoked_at");
  }
  if (input.status === "REVOKED") {
    if (!input.revoked_at) {
      throw new Error("REJECT_DELEGATION_STATUS_ISSUE: REVOKED requires revoked_at");
    }
    const revokedMs = Date.parse(input.revoked_at);
    if (Number.isNaN(revokedMs)) {
      throw new Error("REJECT_DELEGATION_STATUS_ISSUE: invalid revoked_at");
    }
    if (revokedMs > evaluatedMs) {
      throw new Error("REJECT_DELEGATION_STATUS_ISSUE: revoked_at is after evaluated_at");
    }
  }

  const predicate: DelegationStatusPredicate = {
    delegation_artifact_id: input.delegation_ref.artifact_id,
    delegation_content_hash: input.delegation_ref.content_hash.digest,
    status: input.status,
    evaluated_at: input.evaluated_at,
    ...(input.revoked_at !== undefined ? { revoked_at: input.revoked_at } : {}),
    attestation_schema_version: DELEGATION_STATUS_SCHEMA_VERSION,
    signer_key_id: input.signing.keyId,
  };

  const attestation = await createArtifactAttestation({
    subjectDigest: `sha256:${input.delegation_ref.content_hash.digest}`,
    predicateType: DELEGATION_STATUS_PREDICATE_TYPE,
    predicate: { ...predicate },
    signing: input.signing,
  });

  const contentHash = sha256ContentHash(attestation);
  const reference: ContentReference = {
    id: `authority-delegation-status-${contentHash.value}`,
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
