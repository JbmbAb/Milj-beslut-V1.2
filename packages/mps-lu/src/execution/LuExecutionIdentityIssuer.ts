import { createArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { sha256ContentHash, type ArtifactRepositoryPort } from '../../../mps-runtime/src/kernel/ExecutionKernel.js';
import type { ExecutionIdentityArtifact } from '../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js';
import type { ArtifactReference } from '../../../mps-compliance/src/artifacts/ArtifactReference.js';
import { getLuExecutionAuthoritySigningProvider } from '../../../../server/security/luExecutionAuthoritySigningKey.js';
import {
  buildExecutionIdentityAttestationPredicate,
  executionIdentityCanonicalBody,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from './ExecutionIdentityAttestation.js';
import {
  computeExecutionIdentityArtifactIdV2,
  computeExecutionIdentityArtifactIdV3,
  LU_EXECUTION_IDENTITY_SCOPE_V2,
  LU_EXECUTION_IDENTITY_SCOPE_V3,
  type ExecutionIdentitySubjectV2,
  type ExecutionIdentitySubjectV3,
} from '../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js';

/**
 * PROD-LU-ADMISSION-02D — the ONLY module that mints execution identities.
 *
 * Deliberately separate from LuExecutionKernelClient.ts, which must never import this file or
 * getLuExecutionAuthoritySigningProvider -- that separation is the entire trust boundary
 * PROD-LU-ADMISSION-02 exists to establish. This module is called explicitly by whatever
 * provisions LU execution identities ahead of a run (an operator/composition-root step, or a
 * test that wants to exercise the real-admission path) -- never implicitly by the kernel client
 * itself on every invocation, which would just be self-signing wearing a different file name.
 */
/**
 * LEGACY V1 (LU-EXECUTION-IDENTITY-SCOPE-V2, OWNER FREEZE 2026-08-21): site_id-only scoped
 * (`artifact_id = "lu-identity-" + site_id`). Kept only for existing V1 artifacts to remain
 * readable/verifiable and for explicit historical replay. Current product issuance must use
 * `issueExecutionIdentityV2` below -- never this function.
 */
export async function issueExecutionIdentity(input: {
  readonly site_id: string;
  readonly deterministic_seed: string;
  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  /** Required when the V1 root/issuer chain is configured for a product runtime. */
  readonly issuer_ref?: ArtifactReference;
  readonly governed_references?: readonly ArtifactReference[];
  readonly artifact_repository: ArtifactRepositoryPort;
}): Promise<ExecutionIdentityArtifact> {
  const signer = getLuExecutionAuthoritySigningProvider();

  const unsignedIdentity: Omit<ExecutionIdentityArtifact, 'content_hash'> = {
    artifact_id: `lu-identity-${input.site_id}`,
    artifact_type: 'execution_identity',
    references: [
      ...(input.issuer_ref ? [input.issuer_ref] : []),
      ...(input.governed_references ?? []),
    ],
    actor_ref: input.actor_ref,
    capability_ref: input.capability_ref,
    signature_envelope_ref: {
      artifact_id: `lu-identity-attestation-${input.site_id}`,
      artifact_type: 'outcome_attestation',
    },
  };
  const identity: ExecutionIdentityArtifact = {
    ...unsignedIdentity,
    content_hash: sha256ContentHash(executionIdentityCanonicalBody(unsignedIdentity as ExecutionIdentityArtifact)),
  };

  const predicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    release_snapshot_id: input.release_snapshot_id,
    site_id: input.site_id,
    deterministic_seed: input.deterministic_seed,
  });

  const attestation = await createArtifactAttestation({
    subjectDigest: identity.content_hash.value,
    predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
    // LU-ISSUER-TYPE-CLOSURE-01: interfaces are not implicitly assignable to
    // Record<string, unknown> in TypeScript. Spreading into a fresh object literal satisfies the
    // index-signature type without a cast that would hide a real future field mismatch.
    predicate: { ...predicate },
    signing: signer,
  });

  await input.artifact_repository.put({
    artifact_id: identity.artifact_id,
    content_hash: identity.content_hash,
    body: identity,
  });
  await input.artifact_repository.put({
    artifact_id: identity.signature_envelope_ref.artifact_id,
    content_hash: sha256ContentHash(attestation),
    body: attestation,
  });

  return identity;
}

/**
 * LU-EXECUTION-IDENTITY-SCOPE-V2 (OWNER FREEZE 2026-08-21) — the ONLY function that should mint
 * execution identities for current product issuance from here on. `artifact_id` is a deterministic
 * hash of the full V2 subject (site_id + project_context_binding_ref + product_release_ref +
 * execution_contract_version): the same subject always re-derives the same artifact_id (a true
 * idempotent CAS re-write, not a WORM violation), and any change to that subject — most
 * importantly a corrected `project_context_binding_ref` — naturally mints a distinct, coexisting
 * immutable identity instead of colliding with the one issued under the prior context.
 */
export async function issueExecutionIdentityV2(input: {
  readonly subject: ExecutionIdentitySubjectV2;
  readonly deterministic_seed: string;
  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly issuer_ref?: ArtifactReference;
  readonly governed_references?: readonly ArtifactReference[];
  readonly artifact_repository: ArtifactRepositoryPort;
}): Promise<ExecutionIdentityArtifact> {
  const signer = getLuExecutionAuthoritySigningProvider();
  const artifactId = computeExecutionIdentityArtifactIdV2(input.subject);

  const unsignedIdentity: Omit<ExecutionIdentityArtifact, 'content_hash'> = {
    artifact_id: artifactId,
    artifact_type: 'execution_identity',
    references: [
      ...(input.issuer_ref ? [input.issuer_ref] : []),
      ...(input.governed_references ?? []),
    ],
    actor_ref: input.actor_ref,
    capability_ref: input.capability_ref,
    signature_envelope_ref: {
      artifact_id: `lu-identity-attestation-${artifactId}`,
      artifact_type: 'outcome_attestation',
    },
    execution_identity_contract_version: LU_EXECUTION_IDENTITY_SCOPE_V2,
    subject_v2: input.subject,
  };
  const identity: ExecutionIdentityArtifact = {
    ...unsignedIdentity,
    content_hash: sha256ContentHash(executionIdentityCanonicalBody(unsignedIdentity as ExecutionIdentityArtifact)),
  };

  const predicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    release_snapshot_id: input.release_snapshot_id,
    site_id: input.subject.site_id,
    deterministic_seed: input.deterministic_seed,
  });

  const attestation = await createArtifactAttestation({
    subjectDigest: identity.content_hash.value,
    predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
    predicate: { ...predicate },
    signing: signer,
  });

  await input.artifact_repository.put({
    artifact_id: identity.artifact_id,
    content_hash: identity.content_hash,
    body: identity,
  });
  await input.artifact_repository.put({
    artifact_id: identity.signature_envelope_ref.artifact_id,
    content_hash: sha256ContentHash(attestation),
    body: attestation,
  });

  return identity;
}

/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 (OWNER FREEZE 2026-08-22) — mints identities scoped by the
 * V3 subject (V2's four fields plus `localization_geometry_ref`). Same idempotent-CAS-rewrite
 * reasoning as `issueExecutionIdentityV2`: the same five-field subject always re-derives the same
 * `artifact_id`; a moved localization point mints a distinct, coexisting immutable identity
 * instead of colliding with or silently reusing the one issued for the prior point.
 */
export async function issueExecutionIdentityV3(input: {
  readonly subject: ExecutionIdentitySubjectV3;
  readonly deterministic_seed: string;
  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly issuer_ref?: ArtifactReference;
  readonly governed_references?: readonly ArtifactReference[];
  readonly artifact_repository: ArtifactRepositoryPort;
}): Promise<ExecutionIdentityArtifact> {
  const signer = getLuExecutionAuthoritySigningProvider();
  const artifactId = computeExecutionIdentityArtifactIdV3(input.subject);

  const unsignedIdentity: Omit<ExecutionIdentityArtifact, 'content_hash'> = {
    artifact_id: artifactId,
    artifact_type: 'execution_identity',
    references: [
      ...(input.issuer_ref ? [input.issuer_ref] : []),
      ...(input.governed_references ?? []),
    ],
    actor_ref: input.actor_ref,
    capability_ref: input.capability_ref,
    signature_envelope_ref: {
      artifact_id: `lu-identity-attestation-${artifactId}`,
      artifact_type: 'outcome_attestation',
    },
    execution_identity_contract_version: LU_EXECUTION_IDENTITY_SCOPE_V3,
    subject_v3: input.subject,
  };
  const identity: ExecutionIdentityArtifact = {
    ...unsignedIdentity,
    content_hash: sha256ContentHash(executionIdentityCanonicalBody(unsignedIdentity as ExecutionIdentityArtifact)),
  };

  const predicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    release_snapshot_id: input.release_snapshot_id,
    site_id: input.subject.site_id,
    deterministic_seed: input.deterministic_seed,
  });

  const attestation = await createArtifactAttestation({
    subjectDigest: identity.content_hash.value,
    predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
    predicate: { ...predicate },
    signing: signer,
  });

  await input.artifact_repository.put({
    artifact_id: identity.artifact_id,
    content_hash: identity.content_hash,
    body: identity,
  });
  await input.artifact_repository.put({
    artifact_id: identity.signature_envelope_ref.artifact_id,
    content_hash: sha256ContentHash(attestation),
    body: attestation,
  });

  return identity;
}
