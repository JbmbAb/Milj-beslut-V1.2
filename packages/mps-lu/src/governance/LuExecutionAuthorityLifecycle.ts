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
  type LuExecutionAuthorityRootArtifact,
} from "../artifacts/LuExecutionAuthorityArtifact.js";

export const LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE =
  "lu_execution_authority_lifecycle" as const;
export const LU_EXECUTION_AUTHORITY_LIFECYCLE_VERSION =
  "lu-execution-authority-lifecycle-v1" as const;
export const LU_EXECUTION_AUTHORITY_LIFECYCLE_PREDICATE =
  "lu.execution_authority_lifecycle.v1" as const;
export const LU_EXECUTION_AUTHORITY_LIFECYCLE_ID_ENV =
  "LU_EXECUTION_AUTHORITY_LIFECYCLE_ID" as const;

/**
 * Root-signed issuer-wide lifecycle/qualification state.
 *
 * Unlike the per-attempt authorization ticket, this artifact is intentionally issuer-scoped.
 * One process-wide lifecycle pointer is therefore correct: every LU ExecutionIdentity issued by
 * this issuer is governed by the same current qualification/revocation state.
 *
 * The artifact is immutable. Rotation/renewal/revocation creates a new artifact and deployment
 * points LU_EXECUTION_AUTHORITY_LIFECYCLE_ID at that root-signed state. Currentness is checked
 * against the verifier's own wall clock; the wall clock never enters artifact identity.
 */
export interface LuExecutionAuthorityLifecycleArtifact extends ArtifactContract {
  readonly artifact_type: typeof LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE;
  readonly payload: {
    readonly contract_version: typeof LU_EXECUTION_AUTHORITY_LIFECYCLE_VERSION;
    readonly root_ref: ArtifactReference;
    readonly root_hash: ContentHash;
    readonly issuer_ref: ArtifactReference;
    readonly issuer_hash: ContentHash;
    readonly authority_scope: typeof LU_EXECUTION_AUTHORITY_SCOPE;
    readonly valid_from: string;
    readonly valid_until: string;
    readonly revoked_at: string | null;
    readonly previous_lifecycle_ref?: ArtifactReference;
  };
  readonly attestation?: ArtifactAttestation;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: ${field} is required`);
  }
  return normalized;
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: ${field} must be ISO-8601`);
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

function predicate(
  lifecycle: Omit<LuExecutionAuthorityLifecycleArtifact, "attestation">,
) {
  return {
    contract_version: lifecycle.payload.contract_version,
    root_ref: lifecycle.payload.root_ref,
    root_hash: lifecycle.payload.root_hash,
    issuer_ref: lifecycle.payload.issuer_ref,
    issuer_hash: lifecycle.payload.issuer_hash,
    authority_scope: lifecycle.payload.authority_scope,
    valid_from: lifecycle.payload.valid_from,
    valid_until: lifecycle.payload.valid_until,
    revoked_at: lifecycle.payload.revoked_at,
    ...(lifecycle.payload.previous_lifecycle_ref
      ? { previous_lifecycle_ref: lifecycle.payload.previous_lifecycle_ref }
      : {}),
  };
}

export function createLuExecutionAuthorityLifecycleArtifact(input: {
  readonly root: LuExecutionAuthorityRootArtifact;
  readonly issuer: LuExecutionAuthorityIssuerArtifact;
  readonly valid_from: string;
  readonly valid_until: string;
  readonly revoked_at?: string | null;
  readonly previous_lifecycle_ref?: ArtifactReference;
}): Omit<LuExecutionAuthorityLifecycleArtifact, "attestation"> {
  const validFrom = iso(input.valid_from, "valid_from");
  const validUntil = iso(input.valid_until, "valid_until");
  if (Date.parse(validFrom) >= Date.parse(validUntil)) {
    throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: invalid qualification window");
  }
  const revokedAt = input.revoked_at == null ? null : iso(input.revoked_at, "revoked_at");
  const rootRef = ref(
    { artifact_id: input.root.artifact_id, artifact_type: input.root.artifact_type },
    "root_ref",
  );
  const issuerRef = ref(
    { artifact_id: input.issuer.artifact_id, artifact_type: input.issuer.artifact_type },
    "issuer_ref",
  );
  if (!sameRef(input.issuer.payload.root_ref, rootRef)) {
    throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: issuer/root binding");
  }
  const previousRef = input.previous_lifecycle_ref
    ? ref(input.previous_lifecycle_ref, "previous_lifecycle_ref")
    : undefined;
  if (previousRef?.artifact_type !== LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE) {
    if (previousRef) {
      throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: previous lifecycle type");
    }
  }

  const payload = {
    contract_version: LU_EXECUTION_AUTHORITY_LIFECYCLE_VERSION,
    root_ref: rootRef,
    root_hash: input.root.content_hash,
    issuer_ref: issuerRef,
    issuer_hash: input.issuer.content_hash,
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    valid_from: validFrom,
    valid_until: validUntil,
    revoked_at: revokedAt,
    ...(previousRef ? { previous_lifecycle_ref: previousRef } : {}),
  } as const;
  const artifact = {
    artifact_id: `lu-execution-authority-lifecycle-${sha256ContentHash({
      artifact_type: LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
      payload,
    }).value.slice(0, 24)}`,
    artifact_type: LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
    references: [rootRef, issuerRef, ...(previousRef ? [previousRef] : [])],
    payload,
  } as const;
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateLuExecutionAuthorityLifecycleArtifact(
  artifact: LuExecutionAuthorityLifecycleArtifact,
  input: {
    readonly root: LuExecutionAuthorityRootArtifact;
    readonly issuer: LuExecutionAuthorityIssuerArtifact;
  },
): LuExecutionAuthorityLifecycleArtifact {
  const rebuilt = createLuExecutionAuthorityLifecycleArtifact({
    root: input.root,
    issuer: input.issuer,
    valid_from: artifact.payload.valid_from,
    valid_until: artifact.payload.valid_until,
    revoked_at: artifact.payload.revoked_at,
    previous_lifecycle_ref: artifact.payload.previous_lifecycle_ref,
  });
  if (
    artifact.artifact_type !== rebuilt.artifact_type ||
    artifact.artifact_id !== rebuilt.artifact_id ||
    !sameHash(artifact.content_hash, rebuilt.content_hash)
  ) {
    throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: canonical mismatch");
  }
  return artifact;
}

export async function attestLuExecutionAuthorityLifecycle(args: {
  readonly lifecycle: Omit<LuExecutionAuthorityLifecycleArtifact, "attestation">;
  readonly root: LuExecutionAuthorityRootArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.root.payload.root_key_id) {
    throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: signer is not LU root");
  }
  if (
    !sameRef(args.lifecycle.payload.root_ref, {
      artifact_id: args.root.artifact_id,
      artifact_type: args.root.artifact_type,
    }) ||
    !sameHash(args.lifecycle.payload.root_hash, args.root.content_hash)
  ) {
    throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: root binding");
  }
  return createArtifactAttestation({
    subjectDigest: args.lifecycle.content_hash.value,
    predicateType: LU_EXECUTION_AUTHORITY_LIFECYCLE_PREDICATE,
    predicate: predicate(args.lifecycle),
    signing: args.signing,
  });
}

export async function verifyLuExecutionAuthorityLifecycle(args: {
  readonly lifecycle: LuExecutionAuthorityLifecycleArtifact;
  readonly root: LuExecutionAuthorityRootArtifact;
  readonly issuer: LuExecutionAuthorityIssuerArtifact;
  readonly root_verification: VerificationKeyProvider;
}): Promise<LuExecutionAuthorityLifecycleArtifact> {
  const lifecycle = validateLuExecutionAuthorityLifecycleArtifact(args.lifecycle, {
    root: args.root,
    issuer: args.issuer,
  });
  const attestation = lifecycle.attestation;
  if (
    !attestation ||
    attestation.signer !== args.root.payload.root_key_id ||
    attestation.subjectDigest !== lifecycle.content_hash.value ||
    attestation.predicateType !== LU_EXECUTION_AUTHORITY_LIFECYCLE_PREDICATE ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(predicate(lifecycle)) ||
    !(await verifyArtifactAttestation(attestation, args.root_verification))
  ) {
    throw new Error("REJECT_LU_EXECUTION_AUTHORITY_LIFECYCLE: signature");
  }
  return lifecycle;
}

/**
 * Current runtime gate. This intentionally uses the verifier's wall clock: current qualification
 * and revocation are admission predicates, not part of deterministic artifact identity.
 */
export function assertLuExecutionAuthorityLifecycleCurrent(
  lifecycle: LuExecutionAuthorityLifecycleArtifact,
): void {
  const now = Date.now();
  if (now < Date.parse(lifecycle.payload.valid_from)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: qualification_not_active");
  }
  if (now >= Date.parse(lifecycle.payload.valid_until)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: qualification_expired");
  }
  if (
    lifecycle.payload.revoked_at !== null &&
    now >= Date.parse(lifecycle.payload.revoked_at)
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: authority_revoked");
  }
}
