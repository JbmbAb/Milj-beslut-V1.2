/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01.
 *
 * The bounded, versioned context assembler. Its whole reason to exist is one rule:
 *
 *   retrieval set = authority boundary
 *   context assembler -> may narrow, may NOT expand
 *
 * It takes exactly the RetrievalResultFields[] a single governed retrieval run produced (already
 * proven, per LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01, to each resolve back to a real governed
 * chunk), plus that chunk's real text, and selects a bounded SUBSET for the answer model's prompt.
 * It never fetches, guesses, or otherwise introduces a fragment that was not already in the input
 * array -- there is no code path here that can reach outside its own `results` parameter.
 *
 * A result with no provenance ref is dropped, not merely disfavored -- it is not admissible for
 * citation at all (buildRetrievalResult already requires at least one, but this stays enforced
 * here too, as a second, independent gate on what an answer is ever allowed to cite).
 */

import type { RetrievalResultFields } from "@miljobeslut/mps-legal-retrieval-contract";

export const LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION = "legal-answer-context-v1" as const;

export interface LegalAnswerContextPolicy {
  readonly max_results: number;
  readonly max_total_chars: number;
}

export const DEFAULT_ANSWER_CONTEXT_POLICY: LegalAnswerContextPolicy = Object.freeze({
  max_results: 8,
  max_total_chars: 24_000,
});

export class LegalAnswerContextError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LegalAnswerContextError";
  }
}

/** A RetrievalResultFields paired with its real chunk text -- the context assembler is the only
 *  place in this track that needs actual text, not just identity/score. */
export interface RetrievalResultWithContent {
  readonly result: RetrievalResultFields;
  readonly content: string;
}

export interface LegalAnswerContextEntry {
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly source_provenance_refs: readonly string[];
  readonly content: string;
  readonly rank: number;
  readonly score: number;
}

export interface LegalAnswerContextV1 {
  readonly contract_version: typeof LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION;
  readonly context_policy_version: string;
  readonly query_run_identity: string;
  readonly policy: LegalAnswerContextPolicy;
  /** Exactly the entries admitted into the prompt, in the order they were selected. */
  readonly selected: readonly LegalAnswerContextEntry[];
  /** fragment_ids in selection order -- a plain, auditable trail distinct from `selected` itself. */
  readonly selection_order: readonly string[];
  readonly excluded_as_duplicate: readonly string[];
  readonly excluded_by_budget: readonly string[];
  readonly excluded_missing_provenance: readonly string[];
}

/**
 * Builds a bounded context from a governed retrieval run's own results. Pure and deterministic:
 * the same `items` array under the same policy always produces the same selection, in the same
 * order -- required for LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 proof 10 (replay determinism).
 *
 * Narrowing rules, applied in order, over the items AS GIVEN (never re-fetched, never reordered
 * before this pass -- rank order from the retrieval run is trusted as-is):
 *   1. drop any item with zero source_provenance_refs (not admissible for citation)
 *   2. drop any item whose embedding_identity.chunk_content_hash duplicates an already-selected
 *      item's (near-duplicate text, e.g. the known Part-G duplicate MMÖD materialization)
 *   3. stop admitting once max_results is reached, or once the next item would push the running
 *      character budget over max_total_chars
 */
export function buildLegalAnswerContext(
  items: readonly RetrievalResultWithContent[],
  policy: LegalAnswerContextPolicy = DEFAULT_ANSWER_CONTEXT_POLICY,
): LegalAnswerContextV1 {
  if (items.length === 0) {
    throw new LegalAnswerContextError(
      "EMPTY_RETRIEVAL_SET",
      "EMPTY_RETRIEVAL_SET: cannot build an answer context from zero retrieval results -- caller must handle this as INSUFFICIENT_EVIDENCE before calling here",
    );
  }

  const queryRunIdentity = items[0]!.result.query_run_identity;
  for (const item of items) {
    if (item.result.query_run_identity !== queryRunIdentity) {
      throw new LegalAnswerContextError(
        "QUERY_RUN_IDENTITY_MISMATCH",
        "QUERY_RUN_IDENTITY_MISMATCH: all retrieval results fed into one answer context must belong to the same query run",
      );
    }
  }

  const selected: LegalAnswerContextEntry[] = [];
  const excludedAsDuplicate: string[] = [];
  const excludedByBudget: string[] = [];
  const excludedMissingProvenance: string[] = [];
  const seenContentHashes = new Set<string>();
  let runningChars = 0;

  for (const item of items) {
    const { result, content } = item;

    if (result.source_provenance_refs.length === 0) {
      excludedMissingProvenance.push(result.fragment_id);
      continue;
    }

    const contentHash = result.embedding_identity.chunk_content_hash;
    if (seenContentHashes.has(contentHash)) {
      excludedAsDuplicate.push(result.fragment_id);
      continue;
    }

    if (selected.length >= policy.max_results) {
      excludedByBudget.push(result.fragment_id);
      continue;
    }
    if (runningChars + content.length > policy.max_total_chars) {
      excludedByBudget.push(result.fragment_id);
      continue;
    }

    seenContentHashes.add(contentHash);
    runningChars += content.length;
    selected.push({
      fragment_id: result.fragment_id,
      materialization_id: result.materialization_id,
      source_provenance_refs: result.source_provenance_refs,
      content,
      rank: result.rank,
      score: result.score,
    });
  }

  return Object.freeze({
    contract_version: LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION,
    context_policy_version: LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION,
    query_run_identity: queryRunIdentity,
    policy,
    selected: Object.freeze(selected),
    selection_order: Object.freeze(selected.map((s) => s.fragment_id)),
    excluded_as_duplicate: Object.freeze(excludedAsDuplicate),
    excluded_by_budget: Object.freeze(excludedByBudget),
    excluded_missing_provenance: Object.freeze(excludedMissingProvenance),
  });
}
