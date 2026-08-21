import type { ArtifactContract } from "./ArtifactContract";
import type { ArtifactReference } from "./ArtifactReference";
import type { ContentHash } from "./ContentHash";
import { sha256ContentHash } from "../canonical/sha256Canonical";
import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";

export const ADMIN_ROLE_GRANT_ARTIFACT_TYPE = "admin_role_grant" as const;
export const ADMIN_ROLE_GRANT_CONTRACT_VERSION = "admin-role-grant-v1" as const;

/**
 * PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01.
 *
 * The authority scope this grant is minted under. Deliberately distinct from every other
 * issuer purpose in this repo (PROJECT_CONTEXT_BINDING_ISSUER_V1, viewer-capability, dataset
 * admission) -- reusing one of those would let an unrelated authority mint ADMIN role grants.
 */
export const ADMIN_ROLE_GRANT_AUTHORITY_SCOPE = "PRODUCT_ADMIN_ROLE_GRANT_V1" as const;

/**
 * BankID identity refs that are structurally disqualified from ever being the subject of a
 * real product ADMIN grant, independent of any runtime check the issuance service performs.
 * `admin:<username>` is the synthetic admin-console password identity
 * (server/repositories/userRepository.ts ensureAdminConsoleUser); `mock-` is the BankID mock-mode
 * auto-created identity (ensureMockAuthUser). Neither originates from a completed real BankID
 * authentication.
 */
export function isDisqualifiedBankIdSubject(bankidId: string): boolean {
  return bankidId.startsWith("admin:") || bankidId.startsWith("mock-");
}

export interface AdminRoleGrantPayload {
  readonly subject_user_id: string;
  readonly subject_bankid_id: string;
  readonly granted_role: "ADMIN";
  readonly issuer_ref: ArtifactReference;
  readonly issuer_key_id: string;
  readonly authority_scope: typeof ADMIN_ROLE_GRANT_AUTHORITY_SCOPE;
  readonly issued_at: string;
  readonly contract_version: typeof ADMIN_ROLE_GRANT_CONTRACT_VERSION;
}

/**
 * A single, immutable grant of ADMIN authority to one BankID-authenticated subject. Identity
 * proves who the subject is; this artifact -- and only this artifact, once its attestation is
 * verified against the trusted PRODUCT_ADMIN_ROLE_ISSUER_V1 key -- proves they were authorized
 * as ADMIN.
 */
export interface AdminRoleGrantArtifact extends ArtifactContract {
  readonly artifact_type: typeof ADMIN_ROLE_GRANT_ARTIFACT_TYPE;
  readonly payload: AdminRoleGrantPayload;
  /** Attestation is over content_hash and is deliberately excluded from identity. */
  readonly attestation?: ArtifactAttestation;
}

type GrantIdentityPayload = AdminRoleGrantPayload & {
  readonly artifact_type: typeof ADMIN_ROLE_GRANT_ARTIFACT_TYPE;
};

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_ADMIN_ROLE_GRANT: ${field} is required`);
  return normalized;
}

function validateReference(reference: ArtifactReference, field: string): ArtifactReference {
  if (!reference || typeof reference !== "object") {
    throw new Error(`REJECT_ADMIN_ROLE_GRANT: ${field} is required`);
  }
  return {
    artifact_id: requireNonEmpty(String(reference.artifact_id ?? ""), `${field}.artifact_id`),
    artifact_type: requireNonEmpty(String(reference.artifact_type ?? ""), `${field}.artifact_type`),
  };
}

export function adminRoleGrantIdentityPayload(payload: AdminRoleGrantPayload): GrantIdentityPayload {
  if (payload.granted_role !== "ADMIN") {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: granted_role must be ADMIN");
  }
  if (payload.authority_scope !== ADMIN_ROLE_GRANT_AUTHORITY_SCOPE) {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: authority_scope must be PRODUCT_ADMIN_ROLE_GRANT_V1");
  }
  if (payload.contract_version !== ADMIN_ROLE_GRANT_CONTRACT_VERSION) {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: contract_version must be admin-role-grant-v1");
  }
  const subjectBankIdId = requireNonEmpty(payload.subject_bankid_id, "subject_bankid_id");
  if (isDisqualifiedBankIdSubject(subjectBankIdId)) {
    throw new Error(
      `REJECT_ADMIN_ROLE_GRANT: subject_bankid_id '${subjectBankIdId.split(":")[0]}:...' is not a real BankID owner identity`,
    );
  }
  return {
    artifact_type: ADMIN_ROLE_GRANT_ARTIFACT_TYPE,
    subject_user_id: requireNonEmpty(payload.subject_user_id, "subject_user_id"),
    subject_bankid_id: subjectBankIdId,
    granted_role: "ADMIN",
    issuer_ref: validateReference(payload.issuer_ref, "issuer_ref"),
    issuer_key_id: requireNonEmpty(payload.issuer_key_id, "issuer_key_id"),
    authority_scope: ADMIN_ROLE_GRANT_AUTHORITY_SCOPE,
    issued_at: requireNonEmpty(payload.issued_at, "issued_at"),
    contract_version: ADMIN_ROLE_GRANT_CONTRACT_VERSION,
  };
}

export function adminRoleGrantArtifactId(payload: AdminRoleGrantPayload): string {
  const identityHash = sha256ContentHash(adminRoleGrantIdentityPayload(payload));
  return `admin-role-grant-${identityHash.value.slice(0, 24)}`;
}

function grantContentPayload(artifact: Omit<AdminRoleGrantArtifact, "content_hash"> | AdminRoleGrantArtifact): object {
  return {
    artifact_type: artifact.artifact_type,
    artifact_id: artifact.artifact_id,
    references: artifact.references,
    payload: artifact.payload,
  };
}

/** Owner-side construction helper. Runtime routes only validate and resolve this artifact. */
export function createAdminRoleGrantArtifact(args: AdminRoleGrantPayload): Omit<AdminRoleGrantArtifact, "attestation"> {
  const identity = adminRoleGrantIdentityPayload(args);
  const artifact: Omit<AdminRoleGrantArtifact, "content_hash" | "attestation"> = {
    artifact_id: adminRoleGrantArtifactId(args),
    artifact_type: ADMIN_ROLE_GRANT_ARTIFACT_TYPE,
    references: [identity.issuer_ref],
    payload: identity,
  };
  return { ...artifact, content_hash: sha256ContentHash(grantContentPayload(artifact)) };
}

export function adminRoleGrantSubjectDigest(artifact: Omit<AdminRoleGrantArtifact, "attestation">): string {
  return artifact.content_hash.value;
}

/** Validates structure, canonical identity and body hash. Does NOT verify the attestation signature. */
export function validateAdminRoleGrantArtifact(artifact: AdminRoleGrantArtifact): AdminRoleGrantArtifact {
  if (!artifact || typeof artifact !== "object" || artifact.artifact_type !== ADMIN_ROLE_GRANT_ARTIFACT_TYPE) {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: artifact_type must be admin_role_grant");
  }
  if (!artifact.payload || typeof artifact.payload !== "object") {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: payload is required");
  }
  const identity = adminRoleGrantIdentityPayload(artifact.payload);
  const expectedId = adminRoleGrantArtifactId(identity);
  if (artifact.artifact_id !== expectedId) {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: artifact_id does not match canonical identity");
  }
  const expectedHash: ContentHash = sha256ContentHash(grantContentPayload(artifact));
  if (artifact.content_hash?.algorithm !== expectedHash.algorithm || artifact.content_hash?.value !== expectedHash.value) {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: content_hash does not match canonical body");
  }
  if (!artifact.attestation) {
    throw new Error("REJECT_ADMIN_ROLE_GRANT: unsigned grant");
  }
  return artifact;
}
