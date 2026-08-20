/**
 * LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01.
 *
 * Freezes the chain:
 *   LegalCorpusMaterializedChunk -> EmbeddingRecord -> LegalRetrievalPolicy
 *     -> RetrievalExecutionTrace -> RetrievalResult
 *
 * A RetrievalResult is only ever constructed via `buildRetrievalResult`, which enforces the
 * governing invariant as an EXECUTABLE check, not a naming convention:
 *
 *   retrieval result -> MUST always resolve back to the exact governed chunk
 *
 * i.e. its fragment_id/materialization_id must match a real GovernedChunkRef (via
 * GovernedChunkLookupPort), and its embedding_identity must itself be bound to that SAME
 * fragment_id/materialization_id/content_hash -- a result whose embedding was computed for a
 * different chunk, or a stale content hash, is rejected rather than silently returned.
 */

import type { EmbeddingIdentityFields } from "@miljobeslut/mps-embedding-identity";
import type { GovernedChunkLookupPort } from "./GovernedChunkLookup.js";

export const LEGAL_RETRIEVAL_RESULT_CONTRACT_VERSION = "legal-ret-result-1" as const;

export class RetrievalResultError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetrievalResultError";
  }
}

/** Everything a RetrievalResult must carry back, per LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01. */
export interface RetrievalResultInput {
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly source_provenance_refs: readonly string[];
  readonly embedding_identity: EmbeddingIdentityFields;
  readonly retrieval_policy_version: string;
  readonly query_run_identity: string;
  readonly score: number;
  readonly rank: number;
}

export interface RetrievalResultFields extends RetrievalResultInput {
  readonly contract_version: typeof LEGAL_RETRIEVAL_RESULT_CONTRACT_VERSION;
  /** True only because buildRetrievalResult already verified it against a real chunk lookup --
   *  never settable by a caller, never defaulted to true. */
  readonly resolved_against_governed_chunk: true;
}

export function buildRetrievalResult(
  input: RetrievalResultInput,
  chunkLookup: GovernedChunkLookupPort,
): RetrievalResultFields {
  if (input.source_provenance_refs.length === 0) {
    throw new RetrievalResultError(
      "MISSING_PROVENANCE",
      "MISSING_PROVENANCE: a retrieval result must carry at least one source/provenance ref",
    );
  }

  const chunk = chunkLookup.findByFragmentId(input.fragment_id);
  if (!chunk) {
    throw new RetrievalResultError(
      "UNRESOLVED_FRAGMENT",
      `UNRESOLVED_FRAGMENT: fragment_id=${input.fragment_id} does not resolve to any governed chunk`,
    );
  }

  if (chunk.materialization_id !== input.materialization_id) {
    throw new RetrievalResultError(
      "MATERIALIZATION_MISMATCH",
      `MATERIALIZATION_MISMATCH: fragment_id=${input.fragment_id} belongs to materialization_id=${chunk.materialization_id}, not the claimed ${input.materialization_id}`,
    );
  }

  const identity = input.embedding_identity;
  if (
    identity.fragment_id !== chunk.fragment_id ||
    identity.materialization_id !== chunk.materialization_id ||
    identity.chunk_content_hash !== chunk.content_hash
  ) {
    throw new RetrievalResultError(
      "EMBEDDING_IDENTITY_MISMATCH",
      `EMBEDDING_IDENTITY_MISMATCH: embedding_identity was bound to a different chunk (or a ` +
        `stale content_hash) than the governed chunk this result resolves to -- ` +
        `fragment_id/materialization_id/content_hash must match exactly`,
    );
  }

  return Object.freeze({
    fragment_id: input.fragment_id,
    materialization_id: input.materialization_id,
    source_provenance_refs: Object.freeze([...input.source_provenance_refs]),
    embedding_identity: input.embedding_identity,
    retrieval_policy_version: input.retrieval_policy_version,
    query_run_identity: input.query_run_identity,
    score: input.score,
    rank: input.rank,
    contract_version: LEGAL_RETRIEVAL_RESULT_CONTRACT_VERSION,
    resolved_against_governed_chunk: true,
  });
}
