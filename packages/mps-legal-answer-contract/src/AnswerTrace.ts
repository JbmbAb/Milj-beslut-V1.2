/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01.
 *
 * Binds one produced answer to exactly what made it, so it is always possible to say:
 *   "this answer was produced by model X/pipeline Y from retrieval run Z using exactly these
 *    governed fragments."
 *
 * Deliberately NOT the same artifact as RetrievalExecutionTrace (mps-retrieval-trace) -- that
 * trace already binds the retrieval run itself (query_hash/policy_version/selected_artifact_refs)
 * and is not re-derived or duplicated here. AnswerTraceArtifact binds the LAYER ABOVE it: which of
 * the retrieval run's results actually survived context assembly + citation validation to be
 * cited, and by which model/pipeline.
 */

import { createHash } from "node:crypto";

export const LEGAL_ANSWER_TRACE_CONTRACT_VERSION = "legal-answer-trace-v1" as const;

/** QUERY_UNDERSPECIFIED (LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01) is decided BEFORE retrieval even
 *  runs -- distinct from INSUFFICIENT_EVIDENCE, which is decided AFTER real retrieval, based on
 *  whether the evidence actually found supports an answer. A query can be well-specified and still
 *  end in INSUFFICIENT_EVIDENCE (nothing relevant exists); QUERY_UNDERSPECIFIED means the question
 *  itself never carried enough content to search for in the first place.
 *
 *  NAMED_SOURCE_NOT_AVAILABLE (LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01) is decided AFTER
 *  context assembly, BEFORE the answer model is called -- also distinct from
 *  INSUFFICIENT_EVIDENCE: the admitted context may be non-empty and topically relevant, but the
 *  query named a specific statute that context does not actually contain. Answering anyway would
 *  silently substitute a different real source for the one the query asked about -- more dangerous
 *  than a semantic miss, since the resulting answer can be well-cited and still be about the wrong
 *  legal source. */
export type LegalAnswerMode = "ANSWERED" | "INSUFFICIENT_EVIDENCE" | "QUERY_UNDERSPECIFIED" | "NAMED_SOURCE_NOT_AVAILABLE";

export interface AnswerModelIdentity {
  readonly answer_model_id: string;
  readonly answer_model_version: string;
  readonly answer_pipeline_version: string;
}

export interface AnswerTraceInput extends AnswerModelIdentity {
  readonly query_run_identity: string;
  readonly context_policy_version: string;
  readonly mode: LegalAnswerMode;
  /** Only fragments that actually survived citation validation and appear in the returned
   *  answer -- never the raw context selection, and never the raw retrieval hit list. */
  readonly cited_fragment_ids: readonly string[];
}

export interface AnswerTraceArtifact extends AnswerTraceInput {
  readonly contract_version: typeof LEGAL_ANSWER_TRACE_CONTRACT_VERSION;
  readonly answer_trace_hash: string;
}

export function buildAnswerTrace(input: AnswerTraceInput): AnswerTraceArtifact {
  const orderedCited = [...input.cited_fragment_ids];
  const payload = JSON.stringify({
    query_run_identity: input.query_run_identity,
    context_policy_version: input.context_policy_version,
    mode: input.mode,
    cited_fragment_ids: orderedCited,
    answer_model_id: input.answer_model_id,
    answer_model_version: input.answer_model_version,
    answer_pipeline_version: input.answer_pipeline_version,
  });
  const answer_trace_hash = createHash("sha256").update(payload, "utf8").digest("hex");

  return Object.freeze({
    query_run_identity: input.query_run_identity,
    context_policy_version: input.context_policy_version,
    mode: input.mode,
    cited_fragment_ids: Object.freeze(orderedCited),
    answer_model_id: input.answer_model_id,
    answer_model_version: input.answer_model_version,
    answer_pipeline_version: input.answer_pipeline_version,
    contract_version: LEGAL_ANSWER_TRACE_CONTRACT_VERSION,
    answer_trace_hash,
  });
}
