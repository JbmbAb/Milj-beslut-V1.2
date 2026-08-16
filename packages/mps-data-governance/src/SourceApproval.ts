import {
  createArtifactAttestation,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';

import {
  calculateSourceRegistryContentHash,
  sourceRegistryArtifactForHash,
  verifySourceRegistryArtifact,
  SOURCE_APPROVAL_ACTION,
  SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
  SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
  type SourceApprovalAttestationPredicate,
  type SourceRegistryArtifact,
} from './SourceRegistry';

/**
 * 🜃 Source approval — turning a draft into an authority.
 *
 * This is the only place a `SOURCE_REGISTRY_ENTRY` acquires an `approval_attestation`. It exists
 * so that issuing an approval is a deliberate, testable operation rather than something a script
 * does in passing.
 *
 * WHAT THIS DOES NOT DO: it does not decide whether a source *should* be approved. It signs what
 * it is given, with the key it is given. The judgement is the approver's; this only makes the
 * judgement verifiable afterwards.
 *
 * The signed result is verified through `verifySourceRegistryArtifact()` — the SAME function the
 * runtime uses — before it is returned. Producing a signature and assuming it is acceptable
 * would leave the failure to be discovered at load time, on a file someone has already published
 * as approved.
 *
 * @see ./SourceRegistry.ts
 * @see ../../mimers-brunn-core/src/signing/attestation.ts
 */

export class SourceApprovalError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = 'SourceApprovalError';
  }
}

export interface SourceApprovalRequest {
  /** The unsigned draft. MUST NOT already carry an attestation. */
  readonly entry: Omit<SourceRegistryArtifact, 'approval_attestation'> &
    Partial<Pick<SourceRegistryArtifact, 'approval_attestation'>>;
  /** Who is approving. Recorded in the predicate; an empty value is refused. */
  readonly approver_actor_id: string;
  readonly signing: SigningKeyProvider;
}

/**
 * Signs a draft and returns the APPROVED artifact.
 *
 * Fail-closed before signing: re-approving an already-signed entry, or approving without naming
 * an approver, would both produce a technically valid signature over a governance act nobody can
 * be held to.
 */
export async function approveSourceRegistryEntry(
  request: SourceApprovalRequest,
): Promise<SourceRegistryArtifact> {
  const { entry, approver_actor_id, signing } = request;

  if (entry.approval_attestation) {
    throw new SourceApprovalError(
      `REJECT_ALREADY_APPROVED: '${entry.source_id}' already carries an approval_attestation. ` +
        're-signing would silently replace one approver’s act with another’s.',
      'REJECT_ALREADY_APPROVED',
    );
  }

  if (!approver_actor_id || approver_actor_id.trim().length === 0) {
    throw new SourceApprovalError(
      'REJECT_NO_APPROVER: an approval must name who made it. An unattributed approval is not ' +
        'a governance act.',
      'REJECT_NO_APPROVER',
    );
  }

  // The hash covers the substantive fields only — not artifact_id, not lifecycle_state — so the
  // digest computed from the REGISTERED draft is the same one that binds the APPROVED artifact.
  const unsigned = sourceRegistryArtifactForHash(entry as SourceRegistryArtifact);
  const source_content_hash = calculateSourceRegistryContentHash(unsigned);

  const predicate: SourceApprovalAttestationPredicate = {
    action: SOURCE_APPROVAL_ACTION,
    source_id: entry.source_id,
    source_content_hash,
    approver_actor_id,
    approver_role: 'GOVERNANCE_REVIEWER',
    attestation_schema_version: SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
    signer_key_id: signing.keyId,
  };

  const approval_attestation = await createArtifactAttestation({
    subjectDigest: `sha256:${source_content_hash}`,
    predicateType: SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
    predicate: predicate as unknown as Record<string, unknown>,
    signing,
  });

  const approved: SourceRegistryArtifact = {
    ...(entry as SourceRegistryArtifact),
    lifecycle_state: 'APPROVED',
    approval_attestation,
  };

  // The proof that matters: what was just issued is what the runtime will accept. Verified here
  // rather than trusted, and through the production function rather than a re-implementation.
  try {
    await verifySourceRegistryArtifact(approved, signing);
  } catch (error) {
    throw new SourceApprovalError(
      `REJECT_SELF_VERIFICATION: the signed entry for '${entry.source_id}' does not pass the ` +
        `runtime's own verification: ${error instanceof Error ? error.message : String(error)}`,
      'REJECT_SELF_VERIFICATION',
    );
  }

  return approved;
}
