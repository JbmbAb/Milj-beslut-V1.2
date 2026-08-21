import type { ArtifactAttestation, VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { verifyArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { sha256ContentHash } from '../../../mps-runtime/src/kernel/ExecutionKernel.js';
import type { ExecutionIdentityArtifact } from '../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js';
import {
  computeExecutionIdentityArtifactIdV1,
  computeExecutionIdentityArtifactIdV2,
  LU_EXECUTION_IDENTITY_SCOPE_V1,
  LU_EXECUTION_IDENTITY_SCOPE_V2,
  type ExecutionIdentitySubjectV2,
} from '../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js';
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

/**
 * Canonical authority-bearing body for an execution identity. The attestation signs this hash,
 * so consumers must recompute it before trusting either the declared hash or the predicate.
 */
export function executionIdentityCanonicalBody(identity: ExecutionIdentityArtifact): object {
  return {
    artifact_id: identity.artifact_id,
    artifact_type: identity.artifact_type,
    references: identity.references,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    signature_envelope_ref: identity.signature_envelope_ref,
    // LU-EXECUTION-IDENTITY-SCOPE-V2: passed through raw, NOT defaulted. A genuine V1 artifact
    // has both fields `undefined`, which the RFC8785 canonicalizer drops entirely (same as
    // JSON.stringify) -- so this body is byte-identical to the pre-V2 shape for every
    // already-persisted V1 identity, and their stored content_hash keeps verifying unchanged.
    execution_identity_contract_version: identity.execution_identity_contract_version,
    subject_v2: identity.subject_v2,
  };
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
        | 'PREDICATE_MISMATCH'
        | 'ARTIFACT_ID_MISMATCH'
        | 'SUBJECT_MISMATCH'
        | 'UNKNOWN_CONTRACT_VERSION'
        | 'LEGACY_IDENTITY_NOT_ALLOWED';
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
 *
 * LU-EXECUTION-IDENTITY-SCOPE-V2 verification order (OWNER FREEZE 2026-08-21, revised): artifact
 * structure (canonical content hash, deterministic artifact_id from the declared V1/V2 contract)
 * -> attestation/signature -> issuer/trust -> release/scope (predicate: actor, capability,
 * release_snapshot_id, site_id, deterministic_seed) -> V2 subject binding (does this
 * authenticated identity match the exact site/binding/release/contract this caller expects) ->
 * admission/use. Deliberately in that order: nothing about the artifact's OWN unauthenticated
 * claims (its subject_v2, its declared contract version) is used to make an admission decision
 * until the attestation is fully verified authentic -- a valid signature over a narrow predicate
 * must never let an early decision be made from fields no one has proven were signed by the real
 * authority. Structure checks run first only because they are cheap self-consistency checks that
 * must hold before the later steps are even meaningful to evaluate, not because they are trusted.
 */
export async function verifyExecutionIdentityAttestation(input: {
  readonly identity: ExecutionIdentityArtifact;
  readonly attestation: ArtifactAttestation | null;
  readonly expectedPredicate: LuExecutionIdentityAttestationPredicate;
  readonly authorityVerifier: VerificationKeyProvider;
  /**
   * Required to admit a V2 identity for CURRENT execution against a specific canonical
   * binding/release. Absent means the caller accepts whatever contract the identity legitimately
   * declares about itself (the historical V1 replay path) -- the artifact_id/contract-version
   * self-consistency check below still runs either way. When present, a resolved V1 (legacy)
   * identity is refused outright: a V1 identity must never substitute for an expected V2 one.
   */
  readonly expectedSubjectV2?: ExecutionIdentitySubjectV2;
}): Promise<ExecutionIdentityVerificationResult> {
  const { identity, attestation, expectedPredicate, authorityVerifier, expectedSubjectV2 } = input;

  // 1. ARTIFACT STRUCTURE -- self-consistency only. Nothing here yet trusts that the artifact is
  // authentic; it only checks that the artifact is internally coherent for whatever contract it
  // declares, so later steps have a well-formed shape to verify against.
  const canonicalHash = sha256ContentHash(executionIdentityCanonicalBody(identity));
  if (
    identity.content_hash?.algorithm !== canonicalHash.algorithm ||
    identity.content_hash?.value !== canonicalHash.value
  ) {
    return { verified: false, reason: 'CONTENT_HASH_MISMATCH' };
  }

  const declaredContractVersion = identity.execution_identity_contract_version ?? LU_EXECUTION_IDENTITY_SCOPE_V1;

  if (declaredContractVersion === LU_EXECUTION_IDENTITY_SCOPE_V2) {
    if (!identity.subject_v2) {
      return { verified: false, reason: 'SUBJECT_MISMATCH' };
    }
    if (identity.artifact_id !== computeExecutionIdentityArtifactIdV2(identity.subject_v2)) {
      return { verified: false, reason: 'ARTIFACT_ID_MISMATCH' };
    }
  } else if (declaredContractVersion === LU_EXECUTION_IDENTITY_SCOPE_V1) {
    if (identity.artifact_id !== computeExecutionIdentityArtifactIdV1(expectedPredicate.site_id)) {
      return { verified: false, reason: 'ARTIFACT_ID_MISMATCH' };
    }
  } else {
    return { verified: false, reason: 'UNKNOWN_CONTRACT_VERSION' };
  }

  // 2. ATTESTATION / SIGNATURE, then 3. ISSUER/TRUST, then 4. RELEASE/SCOPE (predicate: actor,
  // capability, release_snapshot_id, site_id, deterministic_seed). Nothing about the artifact's
  // OWN claims (its subject_v2, its contract version) is trusted as authority input until this
  // whole block passes -- a valid signature over a narrow predicate must never be shortcut by an
  // early decision made from unauthenticated fields.
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

  // 5. V2 SUBJECT BINDING -- only now, with the artifact's authenticity and scope fully
  // established, do we decide whether it is admissible as THIS caller's expected identity. A
  // genuinely valid, correctly-signed V1 identity never satisfies a caller that requires V2.
  if (declaredContractVersion === LU_EXECUTION_IDENTITY_SCOPE_V1) {
    if (expectedSubjectV2) {
      return { verified: false, reason: 'LEGACY_IDENTITY_NOT_ALLOWED' };
    }
  } else {
    // declaredContractVersion === V2 (the only other branch reachable past step 1).
    const subject = identity.subject_v2!;
    if (subject.site_id !== expectedPredicate.site_id) {
      return { verified: false, reason: 'SUBJECT_MISMATCH' };
    }
    if (expectedSubjectV2) {
      const matchesExpectedSubject =
        subject.site_id === expectedSubjectV2.site_id &&
        referencesEqual(subject.project_context_binding_ref, expectedSubjectV2.project_context_binding_ref) &&
        referencesEqual(subject.product_release_ref, expectedSubjectV2.product_release_ref) &&
        subject.execution_contract_version === expectedSubjectV2.execution_contract_version;
      if (!matchesExpectedSubject) {
        return { verified: false, reason: 'SUBJECT_MISMATCH' };
      }
    }
  }

  // 6. ADMISSION/USE.
  return { verified: true, identity };
}
