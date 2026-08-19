import type { ArtifactAttestation, VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactContract } from '../../../mps-compliance/src/artifacts/ArtifactContract.js';
import type { ArtifactReference } from '../../../mps-compliance/src/artifacts/ArtifactReference.js';
import type { FrozenCoreVerificationContext } from '../../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js';
import type { ExecutionIdentityArtifact } from '../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js';
import {
  verifyExecutionIdentityAttestation,
  type ExecutionIdentityVerificationResult,
  type LuExecutionIdentityAttestationPredicate,
} from './ExecutionIdentityAttestation.js';

/**
 * PROD-LU-ADMISSION-02C — async pre-verification adapter.
 *
 * RuntimeAdmissionKernel.admit() is synchronous; cryptographic attestation verification is
 * async (VerificationKeyProvider.verify() returns a Promise). This adapter does the async
 * crypto work FIRST, then hands the kernel a plain synchronous resolver -- but the identity is
 * only ever placed into that resolver's map when verification actually succeeded. A denied
 * identity is not merely "flagged denied", it is simply absent: RuntimeAdmissionKernel's
 * existing "Invalid or missing Execution Identity" path fires on its own, with no new trust
 * placed in the kernel to honor a claim. The precise reason code lives on `result`, returned
 * alongside the resolver, for a caller that wants to report why rather than just that.
 *
 * Deliberately not wired into LuExecutionKernelClient yet (that is 02D) and does not touch the
 * capability-type check, RuntimeAdmissionKernel itself, or any production composition.
 */
export interface PreVerifiedAdmissionArtifacts {
  readonly result: ExecutionIdentityVerificationResult;
  /** Synchronous ArtifactResolver for FrozenCoreVerificationContext. Contains the identity iff verified. */
  readonly artifactResolver: FrozenCoreVerificationContext['artifactResolver'];
}

export async function preVerifyExecutionIdentityForAdmission(input: {
  readonly identity: ExecutionIdentityArtifact;
  readonly capabilityArtifact: ArtifactContract;
  /** Resolves the identity's signature_envelope_ref to a real attestation, or null if absent. */
  readonly resolveAttestation: (
    ref: ArtifactReference,
  ) => Promise<ArtifactAttestation | null>;
  readonly expectedPredicate: LuExecutionIdentityAttestationPredicate;
  readonly authorityVerifier: VerificationKeyProvider;
}): Promise<PreVerifiedAdmissionArtifacts> {
  const attestation = await input.resolveAttestation(input.identity.signature_envelope_ref);

  const result = await verifyExecutionIdentityAttestation({
    identity: input.identity,
    attestation,
    expectedPredicate: input.expectedPredicate,
    authorityVerifier: input.authorityVerifier,
  });

  const artifacts = new Map<string, ArtifactContract>();
  // The capability artifact is not gated by identity verification -- RuntimeAdmissionKernel
  // checks it independently, via its own artifact_type check. Only the identity is withheld.
  artifacts.set(
    `${input.capabilityArtifact.artifact_type}:${input.capabilityArtifact.artifact_id}`,
    input.capabilityArtifact,
  );
  if (result.verified) {
    artifacts.set(`${result.identity.artifact_type}:${result.identity.artifact_id}`, result.identity);
  }

  return {
    result,
    artifactResolver: {
      resolve: (ref) => artifacts.get(`${ref.artifact_type}:${ref.artifact_id}`),
    },
  };
}
