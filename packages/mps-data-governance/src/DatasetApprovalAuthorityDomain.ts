/**
 * Authority domain for DatasetApproval signing and verification.
 *
 * Cryptographic capability is not governance authority. Keys that sign CAS
 * promotion, SourceRegistry approval, document-fact review, or DEV-GOV must not
 * be treated as DatasetApproval signers unless an explicit DatasetApproval
 * trust registration authorizes that exact key_id for this domain.
 */
export const DATASET_APPROVAL_AUTHORITY_DOMAIN = "DATASET_APPROVAL" as const;

export type DatasetApprovalAuthorityDomain = typeof DATASET_APPROVAL_AUTHORITY_DOMAIN;

/** Known foreign domains that must never be silently reused for DatasetApproval. */
export const FOREIGN_SIGNING_AUTHORITY_DOMAINS = [
  "CAS_PROMOTION",
  "SOURCE_REGISTRY",
  "DOCUMENT_FACT_REVIEW",
  "DOCUMENT_EVIDENCE_ADMISSION",
  "ADMIN_ROLE_GRANT",
  "LU_EXECUTION_AUTHORITY",
  "VIEWER_IDENTITY",
  "VIEWER_CAPABILITY",
  "LEGAL_CORPUS_IMPORT",
  "DEV_GOV",
] as const;

export type ForeignSigningAuthorityDomain = (typeof FOREIGN_SIGNING_AUTHORITY_DOMAINS)[number];

export interface SignerAuthorityCandidate {
  readonly signer: string;
  readonly authority_domain: string;
  readonly dataset_approval_authorization: "PROVEN" | "NOT_PROVEN";
  readonly reason: string;
}

export function inventoryForeignSignerCandidates(): readonly SignerAuthorityCandidate[] {
  return [
    {
      signer: "ed25519:governance-promotion-v1 / GOVERNANCE_SIGNING_* / ~/.mimers/secrets/governance-signing-key-v1",
      authority_domain: "CAS_PROMOTION",
      dataset_approval_authorization: "NOT_PROVEN",
      reason:
        "Documented in server/security/governanceSigningKey.ts as permanent CAS-promotion attestation only.",
    },
    {
      signer: "ed25519:source-registry-governor-* / SOURCE_REGISTRY_* / ~/.mimers/secrets/source-registry-governor-signing-key-v1",
      authority_domain: "SOURCE_REGISTRY",
      dataset_approval_authorization: "NOT_PROVEN",
      reason: "SourceRegistry approval attestation domain; no DatasetApproval trust registration.",
    },
    {
      signer: "ed25519:document-fact-reviewer-v1 / ~/.mimers/secrets/document-fact-review*-signing-key-v1",
      authority_domain: "DOCUMENT_FACT_REVIEW",
      dataset_approval_authorization: "NOT_PROVEN",
      reason: "Document-fact human verification signer; not a DatasetApproval authority.",
    },
    {
      signer: "DEV-GOV / development-governance tooling",
      authority_domain: "DEV_GOV",
      dataset_approval_authorization: "NOT_PROVEN",
      reason: "Development governance is excluded from production DatasetApproval authority.",
    },
  ];
}
