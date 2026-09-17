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

export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE =
  "lu_source_authority_temporal_status" as const;
export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION =
  "lu-source-authority-temporal-status-v1" as const;
export const LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_PREDICATE =
  "lu.source_authority_temporal_status.v1" as const;

export interface LuSourceAuthorityTemporalStatusArtifact extends ArtifactContract {
  readonly artifact_type: typeof LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE;
  readonly payload: {
    readonly contract_version: typeof LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION;
    readonly root_ref: ArtifactReference;
    readonly root_hash: ContentHash;
    readonly issuer_ref: ArtifactReference;
    readonly issuer_hash: ContentHash;
    readonly subject_ref: ArtifactReference;
    readonly subject_hash: ContentHash;
    readonly authority_scope: typeof LU_EXECUTION_AUTHORITY_SCOPE;
    readonly action: string;
    /** Inclusive lower bound of the qualification. */
    readonly valid_from: string;
    /** Exclusive upper bound of the qualification. */
    readonly valid_until: string;
    /** Canonical historical evaluation instant. Never runtime wall clock. */
    readonly decision_time: string;
    /** Effective revocation instant, or null when not revoked at the signed snapshot. */
    readonly revoked_at: string | null;
  };
  readonly attestation?: ArtifactAttestation;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: ${field} is required`);
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

function predicate(status: Omit<LuSourceAuthorityTemporalStatusArtifact, "attestation">) {
  return {
    contract_version: status.payload.contract_version,
    root_ref: status.payload.root_ref,
    root_hash: status.payload.root_hash,
    issuer_ref: status.payload.issuer_ref,
    issuer_hash: status.payload.issuer_hash,
    subject_ref: status.payload.subject_ref,
    subject_hash: status.payload.subject_hash,
    authority_scope: status.payload.authority_scope,
    action: status.payload.action,
    valid_from: status.payload.valid_from,
    valid_until: status.payload.valid_until,
    decision_time: status.payload.decision_time,
    revoked_at: status.payload.revoked_at,
  };
}

export function createLuSourceAuthorityTemporalStatusArtifact(input: {
  readonly root: LuExecutionAuthorityRootArtifact;
  readonly issuer: LuExecutionAuthorityIssuerArtifact;
  readonly subject: ArtifactContract;
  readonly action: string;
  readonly valid_from: string;
  readonly valid_until: string;
  readonly decision_time: string;
  readonly revoked_at?: string | null;
}): Omit<LuSourceAuthorityTemporalStatusArtifact, "attestation"> {
  const validFrom = iso(input.valid_from, "valid_from");
  const validUntil = iso(input.valid_until, "valid_until");
  if (Date.parse(validFrom) >= Date.parse(validUntil)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: invalid qualification window");
  }
  const decisionTime = iso(input.decision_time, "decision_time");
  const revokedAt = input.revoked_at == null ? null : iso(input.revoked_at, "revoked_at");
  const rootRef = ref(
    { artifact_id: input.root.artifact_id, artifact_type: input.root.artifact_type },
    "root_ref",
  );
  const issuerRef = ref(
    { artifact_id: input.issuer.artifact_id, artifact_type: input.issuer.artifact_type },
    "issuer_ref",
  );
  const subjectRef = ref(
    { artifact_id: input.subject.artifact_id, artifact_type: input.subject.artifact_type },
    "subject_ref",
  );
  const payload = {
    contract_version: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_VERSION,
    root_ref: rootRef,
    root_hash: input.root.content_hash,
    issuer_ref: issuerRef,
    issuer_hash: input.issuer.content_hash,
    subject_ref: subjectRef,
    subject_hash: input.subject.content_hash,
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    action: required(input.action, "action"),
    valid_from: validFrom,
    valid_until: validUntil,
    decision_time: decisionTime,
    revoked_at: revokedAt,
  } as const;
  const identity = sha256ContentHash({
    artifact_type: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
    payload,
  });
  const artifact = {
    artifact_id: `lu-source-authority-status-${identity.value.slice(0, 24)}`,
    artifact_type: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
    references: [rootRef, issuerRef, subjectRef],
    payload,
  } as const;
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateLuSourceAuthorityTemporalStatusArtifact(
  artifact: LuSourceAuthorityTemporalStatusArtifact,
): LuSourceAuthorityTemporalStatusArtifact {
  const rebuilt = createLuSourceAuthorityTemporalStatusArtifact({
    root: {
      artifact_id: artifact.payload.root_ref.artifact_id,
      artifact_type: "lu_execution_authority_root",
      references: [],
      content_hash: artifact.payload.root_hash,
      payload: {
        contract_version: "lu-execution-authority-v1",
        root_key_id: "validation-placeholder",
        public_key_fingerprint: "validation-placeholder",
        delegated_scope: LU_EXECUTION_AUTHORITY_SCOPE,
        allowed_artifact_type: "execution_identity",
        owner_provisioning: "OWNER_PROVISIONED",
      },
    },
    issuer: {
      artifact_id: artifact.payload.issuer_ref.artifact_id,
      artifact_type: "lu_execution_authority_issuer",
      references: [artifact.payload.root_ref],
      content_hash: artifact.payload.issuer_hash,
      payload: {
        contract_version: "lu-execution-authority-v1",
        issuer_key_id: "validation-placeholder",
        public_key_fingerprint: "validation-placeholder",
        root_ref: artifact.payload.root_ref,
        delegated_scope: LU_EXECUTION_AUTHORITY_SCOPE,
        allowed_artifact_type: "execution_identity",
      },
    },
    subject: {
      artifact_id: artifact.payload.subject_ref.artifact_id,
      artifact_type: artifact.payload.subject_ref.artifact_type,
      references: [],
      content_hash: artifact.payload.subject_hash,
    },
    action: artifact.payload.action,
    valid_from: artifact.payload.valid_from,
    valid_until: artifact.payload.valid_until,
    decision_time: artifact.payload.decision_time,
    revoked_at: artifact.payload.revoked_at,
  });

  // Rebuild the canonical body directly with the persisted refs/hashes. The placeholder root/issuer
  // payloads above never enter identity; only their persisted refs/hashes do.
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
  readonly root: LuExecutionAuthorityRootArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.root.payload.root_key_id) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: signer is not LU root");
  }
  if (
    args.status.payload.root_ref.artifact_id !== args.root.artifact_id ||
    !sameHash(args.status.payload.root_hash, args.root.content_hash)
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_TEMPORAL_STATUS: root binding mismatch");
  }
  return createArtifactAttestation({
    subjectDigest: args.status.content_hash.value,
    predicateType: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_PREDICATE,
    predicate: predicate(args.status),
    signing: args.signing,
  });
}

export async function verifyLuSourceAuthorityTemporalStatus(args: {
  readonly status: LuSourceAuthorityTemporalStatusArtifact;
  readonly root: LuExecutionAuthorityRootArtifact;
  readonly issuer: LuExecutionAuthorityIssuerArtifact;
  readonly subject: ArtifactContract;
  readonly expected_action: string;
  readonly root_verification: VerificationKeyProvider;
}): Promise<LuSourceAuthorityTemporalStatusArtifact> {
  const status = validateLuSourceAuthorityTemporalStatusArtifact(args.status);
  const expectedRootRef = { artifact_id: args.root.artifact_id, artifact_type: args.root.artifact_type };
  const expectedIssuerRef = { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type };
  const expectedSubjectRef = { artifact_id: args.subject.artifact_id, artifact_type: args.subject.artifact_type };
  if (
    !sameRef(status.payload.root_ref, expectedRootRef) ||
    !sameHash(status.payload.root_hash, args.root.content_hash) ||
    !sameRef(status.payload.issuer_ref, expectedIssuerRef) ||
    !sameHash(status.payload.issuer_hash, args.issuer.content_hash) ||
    !sameRef(status.payload.subject_ref, expectedSubjectRef) ||
    !sameHash(status.payload.subject_hash, args.subject.content_hash) ||
    status.payload.authority_scope !== LU_EXECUTION_AUTHORITY_SCOPE ||
    status.payload.action !== args.expected_action
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: temporal_status_binding");
  }
  const attestation = status.attestation;
  if (
    !attestation ||
    attestation.signer !== args.root.payload.root_key_id ||
    attestation.subjectDigest !== status.content_hash.value ||
    attestation.predicateType !== LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_PREDICATE ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(predicate(status)) ||
    !(await verifyArtifactAttestation(attestation, args.root_verification))
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: temporal_status_signature");
  }

  const decision = Date.parse(status.payload.decision_time);
  if (decision < Date.parse(status.payload.valid_from)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: qualification_not_active");
  }
  if (decision >= Date.parse(status.payload.valid_until)) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: qualification_expired");
  }
  if (
    status.payload.revoked_at !== null &&
    Date.parse(status.payload.revoked_at) <= decision
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY: authority_revoked");
  }
  return status;
}
