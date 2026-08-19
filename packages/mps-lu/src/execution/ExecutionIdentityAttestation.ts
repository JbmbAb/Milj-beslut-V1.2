import type { ArtifactAttestation, VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { verifyArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import type { ExecutionIdentityArtifact } from '../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js';
import type { ArtifactReference } from '../../../mps-compliance/src/artifacts/ArtifactReference.js';

/**
 * PROD-LU-ADMISSION-02A — the execution identity attestation contract.
 *
 * `ExecutionIdentityArtifact.signature_envelope_ref` names a real, persisted attestation
 * artifact (an `ArtifactAttestation`) instead of being decorative. Reuses the same
 * SLSA-inspired, domain-separated attestation machinery already proven for the source-registry
 * authority (mimers-brunn-core) rather than inventing a second signature format.
 */
export const LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE =
  'lu.execution_identity.v1' as const;

/**
 * The bound facts a valid attestation must cover. Includes the run/execution binding
 * (site_id + deterministic_seed) deliberately: without it, a validly-signed identity for one
 * run could be replayed as the identity for a different run, as long as actor/capability
 * happened to match.
 */
export interface LuExecutionIdentityAttestationPredicate {
  readonly execution_identity_id: string;
  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly site_id: string;
  readonly deterministic_seed: string;
}

export function buildExecutionIdentityAttestationPredicate(input: {
  readonly execution_identity_id: string;
  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly site_id: string;
  readonly deterministic_seed: string;
}): LuExecutionIdentityAttestationPredicate {
  return {
    execution_identity_id: input.execution_identity_id,
    actor_ref: input.actor_ref,
    capability_ref: input.capability_ref,
    release_snapshot_id: input.release_snapshot_id,
    site_id: input.site_id,
    deterministic_seed: input.deterministic_seed,
  };
}

export type ExecutionIdentityVerificationResult =
  | {
      readonly verified: true;
      readonly identity: ExecutionIdentityArtifact;
    }
  | {
      readonly verified: false;
      readonly reason:
        | 'MISSING_ATTESTATION'
        | 'UNKNOWN_SIGNING_KEY'
        | 'INVALID_SIGNATURE'
        | 'CONTENT_HASH_MISMATCH'
        | 'PREDICATE_MISMATCH';
    };

function referencesEqual(a: ArtifactReference, b: ArtifactReference): boolean {
  return a.artifact_id === b.artifact_id && a.artifact_type === b.artifact_type;
}

function predicateMatchesExpected(
  predicate: Record<string, unknown>,
  expected: LuExecutionIdentityAttestationPredicate,
): boolean {
  const p = predicate as Partial<LuExecutionIdentityAttestationPredicate>;
  return (
    p.execution_identity_id === expected.execution_identity_id &&
    p.release_snapshot_id === expected.release_snapshot_id &&
    p.site_id === expected.site_id &&
    p.deterministic_seed === expected.deterministic_seed &&
    !!p.actor_ref &&
    referencesEqual(p.actor_ref, expected.actor_ref) &&
    !!p.capability_ref &&
    referencesEqual(p.capability_ref, expected.capability_ref)
  );
}

/**
 * Verifies that `attestation` genuinely authorizes `identity` for the exact run described by
 * `expectedPredicate` -- not merely that some valid signature exists.
 *
 * `authorityVerifier` must be the LU execution authority's verification-only key (never a
 * SigningKeyProvider -- the LU admission path must not be able to mint what it verifies).
 * `attestation.signer` is checked against `authorityVerifier.keyId` explicitly, before any
 * cryptographic work: this authority holds only one trusted key, so a mismatch is diagnosed as
 * UNKNOWN_SIGNING_KEY rather than falling through to a generic signature failure.
 */
export async function verifyExecutionIdentityAttestation(input: {
  readonly identity: ExecutionIdentityArtifact;
  readonly attestation: ArtifactAttestation | null;
  readonly expectedPredicate: LuExecutionIdentityAttestationPredicate;
  readonly authorityVerifier: VerificationKeyProvider;
}): Promise<ExecutionIdentityVerificationResult> {
  const { identity, attestation, expectedPredicate, authorityVerifier } = input;

  if (!attestation) {
    return { verified: false, reason: 'MISSING_ATTESTATION' };
  }

  if (attestation.signer !== authorityVerifier.keyId) {
    return { verified: false, reason: 'UNKNOWN_SIGNING_KEY' };
  }

  if (attestation.subjectDigest !== identity.content_hash.value) {
    return { verified: false, reason: 'CONTENT_HASH_MISMATCH' };
  }

  if (
    attestation.predicateType !== LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE ||
    !predicateMatchesExpected(attestation.predicate, expectedPredicate)
  ) {
    return { verified: false, reason: 'PREDICATE_MISMATCH' };
  }

  const cryptographicallyValid = await verifyArtifactAttestation(attestation, authorityVerifier);
  if (!cryptographicallyValid) {
    return { verified: false, reason: 'INVALID_SIGNATURE' };
  }

  return { verified: true, identity };
}
