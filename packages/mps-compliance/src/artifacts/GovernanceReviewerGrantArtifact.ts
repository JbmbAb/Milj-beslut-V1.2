import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract } from "./ArtifactContract";
import type { ArtifactReference } from "./ArtifactReference";
import type { ContentHash } from "./ContentHash";
import { sha256ContentHash } from "../canonical/sha256Canonical";

export const GOVERNANCE_REVIEWER_GRANT_ARTIFACT_TYPE = "governance_reviewer_grant" as const;
export const GOVERNANCE_REVIEWER_GRANT_CONTRACT_VERSION = "governance-reviewer-grant-v1" as const;
export const GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE = "GOVERNANCE_REVIEWER_GRANT_V1" as const;
export const GOVERNANCE_REVIEWER_GRANT_PREDICATE_TYPE = "governance_reviewer.grant" as const;

export interface GovernanceReviewerGrantPayload {
  readonly subject_user_id: string;
  readonly subject_bankid_id: string;
  readonly granted_role: "GOVERNANCE_REVIEWER";
  readonly issuer_ref: ArtifactReference;
  readonly issuer_key_id: string;
  readonly authority_scope: typeof GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE;
  readonly issued_at: string;
  readonly contract_version: typeof GOVERNANCE_REVIEWER_GRANT_CONTRACT_VERSION;
}

export interface GovernanceReviewerGrantArtifact extends ArtifactContract {
  readonly artifact_type: typeof GOVERNANCE_REVIEWER_GRANT_ARTIFACT_TYPE;
  readonly payload: GovernanceReviewerGrantPayload;
  readonly attestation?: ArtifactAttestation;
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_GOVERNANCE_REVIEWER_GRANT: ${field} is required`);
  return normalized;
}

function reference(value: ArtifactReference): ArtifactReference {
  if (!value || typeof value !== "object") throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: issuer_ref is required");
  return {
    artifact_id: nonEmpty(String(value.artifact_id ?? ""), "issuer_ref.artifact_id"),
    artifact_type: nonEmpty(String(value.artifact_type ?? ""), "issuer_ref.artifact_type"),
  };
}

export function isDisqualifiedGovernanceReviewerSubject(bankidId: string): boolean {
  return bankidId.startsWith("admin:") || bankidId.startsWith("mock-");
}

export function governanceReviewerGrantIdentityPayload(payload: GovernanceReviewerGrantPayload): GovernanceReviewerGrantPayload & { artifact_type: typeof GOVERNANCE_REVIEWER_GRANT_ARTIFACT_TYPE } {
  const subjectBankId = nonEmpty(payload.subject_bankid_id, "subject_bankid_id");
  if (isDisqualifiedGovernanceReviewerSubject(subjectBankId)) {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: synthetic BankID identity is not eligible");
  }
  if (payload.granted_role !== "GOVERNANCE_REVIEWER") {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: granted_role must be GOVERNANCE_REVIEWER");
  }
  if (payload.authority_scope !== GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE) {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: authority_scope mismatch");
  }
  if (payload.contract_version !== GOVERNANCE_REVIEWER_GRANT_CONTRACT_VERSION) {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: contract_version mismatch");
  }
  return {
    artifact_type: GOVERNANCE_REVIEWER_GRANT_ARTIFACT_TYPE,
    subject_user_id: nonEmpty(payload.subject_user_id, "subject_user_id"),
    subject_bankid_id: subjectBankId,
    granted_role: "GOVERNANCE_REVIEWER",
    issuer_ref: reference(payload.issuer_ref),
    issuer_key_id: nonEmpty(payload.issuer_key_id, "issuer_key_id"),
    authority_scope: GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE,
    issued_at: nonEmpty(payload.issued_at, "issued_at"),
    contract_version: GOVERNANCE_REVIEWER_GRANT_CONTRACT_VERSION,
  };
}

export function governanceReviewerGrantArtifactId(payload: GovernanceReviewerGrantPayload): string {
  return `governance-reviewer-grant-${sha256ContentHash(governanceReviewerGrantIdentityPayload(payload)).value.slice(0, 24)}`;
}

function contentPayload(artifact: Omit<GovernanceReviewerGrantArtifact, "content_hash"> | GovernanceReviewerGrantArtifact): object {
  return { artifact_type: artifact.artifact_type, artifact_id: artifact.artifact_id, references: artifact.references, payload: artifact.payload };
}

export function createGovernanceReviewerGrantArtifact(args: GovernanceReviewerGrantPayload): Omit<GovernanceReviewerGrantArtifact, "attestation"> {
  const payload = governanceReviewerGrantIdentityPayload(args);
  const artifact: Omit<GovernanceReviewerGrantArtifact, "content_hash" | "attestation"> = {
    artifact_id: governanceReviewerGrantArtifactId(payload),
    artifact_type: GOVERNANCE_REVIEWER_GRANT_ARTIFACT_TYPE,
    references: [payload.issuer_ref],
    payload,
  };
  return { ...artifact, content_hash: sha256ContentHash(contentPayload(artifact)) };
}

export function validateGovernanceReviewerGrantArtifact(artifact: GovernanceReviewerGrantArtifact): GovernanceReviewerGrantArtifact {
  if (!artifact || artifact.artifact_type !== GOVERNANCE_REVIEWER_GRANT_ARTIFACT_TYPE || !artifact.payload) {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: artifact_type must be governance_reviewer_grant");
  }
  const payload = governanceReviewerGrantIdentityPayload(artifact.payload);
  if (artifact.artifact_id !== governanceReviewerGrantArtifactId(payload)) {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: artifact_id does not match canonical identity");
  }
  const expectedHash: ContentHash = sha256ContentHash(contentPayload(artifact));
  if (artifact.content_hash?.algorithm !== expectedHash.algorithm || artifact.content_hash?.value !== expectedHash.value) {
    throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: content_hash does not match canonical body");
  }
  if (!artifact.attestation) throw new Error("REJECT_GOVERNANCE_REVIEWER_GRANT: unsigned grant");
  return artifact;
}
