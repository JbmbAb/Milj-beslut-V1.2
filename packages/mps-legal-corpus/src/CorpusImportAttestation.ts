/**
 * ADR: TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md, "SCHEMA-CONVERGENCE-SPEC 2026-08-11 —
 * Juridisk ingestion: approval & provenance" (FROZEN / READY FOR IMPLEMENTATION).
 *
 * Reuses the exact same attestation mechanism already PROVEN for CAS promotion (Level 2,
 * `packages/mimers-brunn-core/src/governance/DatasetApproval.ts`) and specified for the
 * source registry (registry-convergence spec) — `createArtifactAttestation()` /
 * `verifyArtifactAttestation()`. No new signing mechanism for this domain.
 */

/** Domain-separates this attestation kind from promotion-/source-approval-attestations. */
export const LEGAL_CORPUS_IMPORT_ACTION = 'legal.corpus.import' as const;

/** Stable predicateType for legal corpus import attestations (ArtifactAttestation.predicateType). */
export const LEGAL_CORPUS_IMPORT_PREDICATE_TYPE = 'mimers-brunn/legal-corpus-import/v1' as const;

/** Version of the signed predicate's *shape* below — bump on field changes. */
export const LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION = 1;

/**
 * The signed predicate a legal corpus import attestation must carry — all fields inside
 * `ArtifactAttestation.predicate`, i.e. part of the signed bytes, not appended after signing.
 */
export interface LegalCorpusImportAttestationPredicate {
  readonly action: typeof LEGAL_CORPUS_IMPORT_ACTION;
  readonly document_id: string;
  readonly source_content_hash: string;
  readonly chunk_set_content_hash: string;
  readonly pipeline_version: string;
  readonly chunk_policy_version: string;
  readonly approver_actor_id: string;
  readonly approver_role: string;
  readonly attestation_schema_version: number;
  readonly signer_key_id: string;
}

/** Raised when an attestation fails cryptographic verification or binding checks. */
export class LegalCorpusGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegalCorpusGateError';
  }
}
