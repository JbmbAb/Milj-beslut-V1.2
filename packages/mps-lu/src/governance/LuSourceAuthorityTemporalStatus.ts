import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";
import {
  LU_EXECUTION_AUTHORITY_SCOPE,
  type LuExecutionAuthorityIssuerArtifact,
} from "../artifacts/LuExecutionAuthorityArtifact.js";
import type { LuExecutionAuthorityLifecycleArtifact } from "./LuExecutionAuthorityLifecycle.js";

export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE =
  "lu_source_authority_temporal_status" as const;
export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION =
  "lu-source-authority-temporal-status-v3" as const;
export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_PREDICATE =
  "lu.source_authority_temporal_status.v3" as const;

/**
 * Immutable historical authorization ticket for exactly one canonical LU execution attempt.
 *
 * The ticket is signed by the LU issuer and hash-binds the root-signed issuer lifecycle that was
 * current when this exact attempt was authorized. Current expiry/revocation is evaluated separately
 * from the deployment-selected lifecycle artifact at runtime; this ticket proves only the historical
 * `authorized_at_decision_time` claim.
 */
export interface LuSourceAuthorityTemporalStatusArtifact extends ArtifactContract {
  readonly artifact_type: typeof LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE;
  readonly payload: {
    readonly contract_version: typeof LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION;
    readonly issuer_ref: ArtifactReference;
    readonly subject_ref: ArtifactReference;
    readonly subject_hash: ContentHash;
    readonly attempt_ref: ArtifactReference;
    readonly lifecycle_ref: ArtifactReference;
    readonly lifecycle_hash: ContentHash;
    readonly authority_scope: typeof LU_EXECUTION_AUTHORITY_SCOPE;
    readonly action: string;
    /** Signed authority-decision instant for THIS exact execution attempt. */
    readonly decision_time: string;
  };
  readonly attestation?: ArtifactAttestation;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: ${field} is required`);
  }
  return normalized;
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: ${field} must be ISO-8601`);
  }
  return new Date(parsed).toISOString();
}

function ref(value: ArtifactReference, field: string): ArtifactReference {
  return {
    artifact_id: required(value.artifact_id, `${field}.artifact_id`),
    artifact_type: required(value.artifact_type, `${field}.artifact_type`),
  };
}

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function sameHash(left: ContentHash, right: ContentHash): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export function computeLuSourceAuthorityTemporalStatusArtifactId(input: {
  readonly subject_ref: ArtifactReference;
  readonly attempt_ref: ArtifactReference;
  readonly lifecycle_ref: ArtifactReference;
  readonly action: string;
}): string {
  const identity = sha256ContentHash({
    contract: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION,
    subject_ref: ref(input.subject_ref, "subject_ref"),
    attempt_ref: ref(input.attempt_ref, "attempt_ref"),
    lifecycle_ref: ref(input.lifecycle_ref, "lifecycle_ref"),
    action: required(input.action, "action"),
  });
  return `lu-source-authority-status-${identity.value.slice(0, 24)}`;
}

function predicate(status: Omit<LuSourceAuthorityTemporalStatusArtifact, "attestation">) {
  return {
    contract_version: status.payload.contract_version,
    issuer_ref: status.payload.issuer_ref,
    subject_ref: status.payload.subject_ref,
    subject_hash: status.payload.subject_hash,
    attempt_ref: status.payload.attempt_ref,
    lifecycle_ref: status.payload.lifecycle_ref,
    lifecycle_hash: status.payload.lifecycle_hash,
    authority_scope: status.payload.authority_scope,
    action: status.payload.action,
    decision_time: status.payload.decision_time,
  };
}

export function createLuSourceAuthorityTemporalStatusArtifact(input: {
  readonly issuer_ref: ArtifactReference;
  readonly subject: ArtifactContract;
  readonly attempt_ref: ArtifactReference;
  readonly lifecycle: LuExecutionAuthorityLifecycleArtifact;
  readonly action: string;
  readonly decision_time: string;
}): Omit<LuSourceAuthorityTemporalStatusArtifact, "attestation"> {
  const decisionTime = iso(input.decision_time, "decision_time");
  const issuerRef = ref(input.issuer_ref, "issuer_ref");
  const subjectRef = ref(
    { artifact_id: input.subject.artifact_id, artifact_type: input.subject.artifact_type },
    "subject_ref",
  );
  const attemptRef = ref(input.attempt_ref, "attempt_ref");
  const lifecycleRef = ref(
    { artifact_id: input.lifecycle.artifact_id, artifact_type: input.lifecycle.artifact_type },
    "lifecycle_ref",
  );
  if (attemptRef.artifact_type !== "execution_attempt") {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: attempt_ref type");
  }

  const payload = {
    contract_version: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION,
    issuer_ref: issuerRef,
    subject_ref: subjectRef,
    subject_hash: input.subject.content_hash,
    attempt_ref: attemptRef,
    lifecycle_ref: lifecycleRef,
    lifecycle_hash: input.lifecycle.content_hash,
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    action: required(input.action, "action"),
    decision_time: decisionTime,
  } as const;
  const artifact = {
    artifact_id: computeLuSourceAuthorityTemporalStatusArtifactId({
      subject_ref: subjectRef,
      attempt_ref: attemptRef,
      lifecycle_ref: lifecycleRef,
      action: payload.action,
    }),
    artifact_type: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
    references: [issuerRef, subjectRef, attemptRef, lifecycleRef],
    payload,
  } as const;
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateLuSourceAuthorityTemporalStatusArtifact(
  artifact: LuSourceAuthorityTemporalStatusArtifact,
  lifecycle: LuExecutionAuthorityLifecycleArtifact,
): LuSourceAuthorityTemporalStatusArtifact {
  const rebuilt = createLuSourceAuthorityTemporalStatusArtifact({
    issuer_ref: artifact.payload.issuer_ref,
    subject: {
      artifact_id: artifact.payload.subject_ref.artifact_id,
      artifact_type: artifact.payload.subject_ref.artifact_type,
      references: [],
      content_hash: artifact.payload.subject_hash,
    },
    attempt_ref: artifact.payload.attempt_ref,
    lifecycle,
    action: artifact.payload.action,
    decision_time: artifact.payload.decision_time,
  });

  if (
    artifact.artifact_type !== rebuilt.artifact_type ||
    artifact.artifact_id !== rebuilt.artifact_id ||
    !sameHash(artifact.content_hash, rebuilt.content_hash)
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: canonical mismatch");
  }
  return artifact;
}

export async function attestLuSourceAuthorityTemporalStatus(args: {
  readonly status: Omit<LuSourceAuthorityTemporalStatusArtifact, "attestation">;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  return createArtifactAttestation({
    subjectDigest: args.status.content_hash.value,
    predicateType: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_PREDICATE,
    predicate: predicate(args.status),
    signing: args.signing,
  });
}

export async function verifyLuSourceAuthorityTemporalStatus(args: {
  readonly status: LuSourceAuthorityTemporalStatusArtifact;
  readonly issuer: LuExecutionAuthorityIssuerArtifact;
  readonly subject: ArtifactContract;
  readonly lifecycle: LuExecutionAuthorityLifecycleArtifact;
  readonly expected_attempt_ref: ArtifactReference;
  readonly expected_action: string;
  readonly issuer_verification: VerificationKeyProvider;
}): Promise<LuSourceAuthorityTemporalStatusArtifact> {
  const status = validateLuSourceAuthorityTemporalStatusArtifact(args.status, args.lifecycle);
  const expectedIssuerRef = {
    artifact_id: args.issuer.artifact_id,
    artifact_type: args.issuer.artifact_type,
  };
  const expectedSubjectRef = {
    artifact_id: args.subject.artifact_id,
    artifact_type: args.subject.artifact_type,
  };
  const expectedLifecycleRef = {
    artifact_id: args.lifecycle.artifact_id,
    artifact_type: args.lifecycle.artifact_type,
  };
  if (
    !sameRef(status.payload.issuer_ref, expectedIssuerRef) ||
    !sameRef(status.payload.subject_ref, expectedSubjectRef) ||
    !sameHash(status.payload.subject_hash, args.subject.content_hash) ||
    !sameRef(status.payload.attempt_ref, args.expected_attempt_ref) ||
    !sameRef(status.payload.lifecycle_ref, expectedLifecycleRef) ||
    !sameHash(status.payload.lifecycle_hash, args.lifecycle.content_hash) ||
    status.payload.authority_scope !== LU_EXECUTION_AUTHORITY_SCOPE ||
    status.payload.action !== args.expected_action
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: temporal_status_binding");
  }
  const expectedId = computeLuSourceAuthorityTemporalStatusArtifactId({
    subject_ref: expectedSubjectRef,
    attempt_ref: args.expected_attempt_ref,
    lifecycle_ref: expectedLifecycleRef,
    action: args.expected_action,
  });
  if (status.artifact_id !== expectedId) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: temporal_status_identity");
  }

  const attestation = status.attestation;
  if (
    !attestation ||
    attestation.signer !== args.issuer.payload.issuer_key_id ||
    attestation.subjectDigest !== status.content_hash.value ||
    attestation.predicateType !== LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_PREDICATE ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(predicate(status)) ||
    !(await verifyArtifactAttestation(attestation, args.issuer_verification))
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: temporal_status_signature");
  }

  // Historical predicate: the exact attempt was authorized while the bound lifecycle was active.
  const decision = Date.parse(status.payload.decision_time);
  if (decision < Date.parse(args.lifecycle.payload.valid_from)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: qualification_not_active");
  }
  if (decision >= Date.parse(args.lifecycle.payload.valid_until)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: qualification_expired");
  }
  if (
    args.lifecycle.payload.revoked_at !== null &&
    Date.parse(args.lifecycle.payload.revoked_at) <= decision
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: authority_revoked");
  }
  return status;
}
