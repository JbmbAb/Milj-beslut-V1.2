/**
 * KNOWLEDGE-K2.2-GOVERNED-CORPUS-EXPANSION-EVAL-V1 — version constants for the corpus projection
 * kernel. Every identity or provenance record produced by this package names one of these, so a
 * behavior change is a deliberate version bump here, never a silent drift under an unchanged label
 * (the exact defect the archaeology found in the hand-typed script literals this package replaces).
 */

/** Identity namespace for the projection kernel as a whole (input contract + provenance chain shape). */
export const KNOWLEDGE_CORPUS_PROJECTION_VERSION = 'knowledge-corpus-projection-v1' as const;

/** Hash-domain prefix for content-derived document identity (see DocumentIdentity.ts). */
export const KNOWLEDGE_DOCUMENT_IDENTITY_VERSION = 'knowledge-document-v1' as const;

/** Deterministic registry-declaration -> document-role mapping table (see DocumentRole.ts). */
export const SOURCE_ROLE_MAPPING_VERSION = 'source-role-mapping-v1' as const;

/** Deterministic, rule-based cross-document link CANDIDATE derivation (see CorpusProjection.ts). */
export const LINK_CANDIDATE_RULES_VERSION = 'link-candidates-v1' as const;

/**
 * Chunk policy strings already in production use (identity-bearing via
 * LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2). Centralized here so callers import them instead of
 * retyping them; the mapping from policy string to the admitting function lives in
 * ChunkPolicyRegistry (ChunkAdmission.ts) — a policy string with no registered admitter is refused.
 */
export const CHUNK_POLICY_LAW_V241 = 'legal-chunker-v2.4.1' as const;
export const CHUNK_POLICY_TEXT_V23 = 'legal-chunker-v2.3' as const;

/** The ingestion-manifest `pipeline_version` literal every governed run has recorded so far. */
export const INGESTION_PIPELINE_VERSION = 'text-v1.0' as const;
