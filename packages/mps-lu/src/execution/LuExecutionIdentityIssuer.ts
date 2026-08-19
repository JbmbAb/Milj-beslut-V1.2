import { createArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { sha256ContentHash, type ArtifactRepositoryPort } from '../../../mps-runtime/src/kernel/ExecutionKernel.js';
import type { ExecutionIdentityArtifact } from '../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js';
import type { ArtifactReference } from '../../../mps-compliance/src/artifacts/ArtifactReference.js';
import { getLuExecutionAuthoritySigningProvider } from '../../../../server/security/luExecutionAuthoritySigningKey.js';
import {
  buildExecutionIdentityAttestationPredicate,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from './ExecutionIdentityAttestation.js';

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
export async function issueExecutionIdentity(input: {
  readonly site_id: string;
  readonly deterministic_seed: string;
  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly release_snapshot_id: string;
  readonly artifact_repository: ArtifactRepositoryPort;
}): Promise<ExecutionIdentityArtifact> {
  const signer = getLuExecutionAuthoritySigningProvider();

  const identity: ExecutionIdentityArtifact = {
    artifact_id: `lu-identity-${input.site_id}`,
    artifact_type: 'execution_identity',
    content_hash: sha256ContentHash({
      principal_id: input.actor_ref.artifact_id,
      site_id: input.site_id,
      capability_id: input.capability_ref.artifact_id,
      release_snapshot_id: input.release_snapshot_id,
      deterministic_seed: input.deterministic_seed,
    }),
    references: [],
    actor_ref: input.actor_ref,
    capability_ref: input.capability_ref,
    signature_envelope_ref: {
      artifact_id: `lu-identity-attestation-${input.site_id}`,
      artifact_type: 'outcome_attestation',
    },
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
