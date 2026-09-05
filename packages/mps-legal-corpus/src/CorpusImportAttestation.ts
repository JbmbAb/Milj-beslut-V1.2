/**
 * ADR: docs/architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md (ACCEPTED / FROZEN).
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

/**
 * Version of the signed predicate's *shape* below — bump on field changes.
 *
 * v2 (K2.1, CORPUS-ADMISSION-REGISTRY-BINDING): added `registry_artifact_id` and
 * `registry_source_content_hash`, binding the claimed source-registry identity into the SIGNED
 * predicate itself rather than leaving it as an unsigned, caller-supplied label alongside the
 * attestation. Signing them is what makes `CorpusImportGate`'s new registry-authority check an
 * actual binding rather than a check that a real registry entry merely exists somewhere — an
 * unsigned field could be swapped for any other real, approved artifact_id without invalidating
 * the signature.
 */
export const LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION = 2;

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
  /** The SourceRegistryArtifact.artifact_id this document's content claims to originate from. */
  readonly registry_artifact_id: string;
  /** The claimed registry entry's own signed content hash (VerifiedSourceDefinition.sourceContentHash). */
  readonly registry_source_content_hash: string;
}

/** Raised when an attestation fails cryptographic verification or binding checks. */
export class LegalCorpusGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegalCorpusGateError';
  }
}
