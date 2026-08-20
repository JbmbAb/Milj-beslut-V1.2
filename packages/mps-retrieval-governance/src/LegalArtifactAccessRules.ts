/**
 * LEGAL-RETRIEVAL-POLICY-01.
 *
 * A separate, legal-corpus-specific artifact access model. Deliberately NOT an extension of
 * ArtifactAccessRules.ts/RetrievalPolicy.ts: those are hardcoded to the LU decision-evidence
 * domain (MIMER-RET-I01 requires every query to resolve through `DecisionImpactArtifact` first,
 * for all four existing query types) -- a legal-corpus chunk search has no DecisionImpactArtifact
 * in it at all, and forcing one in would be a semantic lie, not a real satisfaction of that
 * invariant. This module shares the LU policy's DISCIPLINE (versioned, read-only, artifact-class
 * isolation) but not its types. The LU policy is unmodified by this file.
 *
 * If real shared mechanics emerge once both policies are proven, extracting a common kernel is a
 * later, separate decision -- not attempted here.
 */

/**
 * `LegalCorpusMaterializedChunk` is the ONLY class retrieval may ever resolve to -- it is the
 * real Prisma model name (see prisma/schema.prisma), not an invented alias.
 *
 * The other two classes exist specifically to make the isolation rule non-trivial and grounded in
 * real, already-established facts from this session, not speculative future-proofing:
 *   - `LegacyLegalCorpusChunk`: the OLD `legal_corpus_chunks` table (see
 *     LEGAL-RETRIEVAL-ARCH-RECON-01) still actively queried by `searchLegalCorpusTool.ts` today.
 *     Governed retrieval must never silently fall back to it.
 *   - `UnsignedDraftChunk`: unsigned Phase B source-registry drafts (see
 *     P2SRLegacyIsNotAuthority.test.ts / P2SR01UnsignedPuhDraft.test.ts elsewhere in this repo) --
 *     never promoted to governed status, never retrievable.
 */
export type LegalArtifactClass =
  | "LegalCorpusMaterializedChunk"
  | "LegacyLegalCorpusChunk"
  | "UnsignedDraftChunk";

export type LegalQueryType = "LEGAL_CORPUS_SEARCH";

export type LegalArtifactAccessRule = {
  readonly query_type: LegalQueryType;
  readonly allowed: readonly LegalArtifactClass[];
  readonly forbidden: readonly LegalArtifactClass[];
  /** Constitutional: the only class retrieval may resolve to for this query type. */
  readonly initial: LegalArtifactClass;
};

export const LEGAL_ARTIFACT_ACCESS_RULES: readonly LegalArtifactAccessRule[] = Object.freeze([
  Object.freeze({
    query_type: "LEGAL_CORPUS_SEARCH",
    allowed: Object.freeze(["LegalCorpusMaterializedChunk"] as const),
    forbidden: Object.freeze(["LegacyLegalCorpusChunk", "UnsignedDraftChunk"] as const),
    initial: "LegalCorpusMaterializedChunk",
  }),
]);

export function getLegalAccessRule(query_type: LegalQueryType): LegalArtifactAccessRule {
  const rule = LEGAL_ARTIFACT_ACCESS_RULES.find((r) => r.query_type === query_type);
  if (!rule) {
    throw new LegalRetrievalGovernanceError(
      "UNKNOWN_LEGAL_QUERY_TYPE",
      `No LegalArtifactAccessRule for query_type=${query_type}`,
    );
  }
  return rule;
}

export class LegalRetrievalGovernanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LegalRetrievalGovernanceError";
  }
}
