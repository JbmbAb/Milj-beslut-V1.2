/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01.
 *
 * The executable form of the governing invariant:
 *
 *   AN ANSWER MAY CITE ONLY A GOVERNED RetrievalResult RETURNED BY THE CURRENT RETRIEVAL RUN.
 *
 * A citation_id is NOT a new authority identity -- it is only a stable representation of refs
 * that were already verified (fragment_id, materialization_id, source_provenance_refs, rank,
 * score, query_run_identity), all of which the caller can already independently re-derive from
 * the LegalAnswerContextV1 this citation was built against. Nothing here creates evidentiary
 * weight the context did not already carry.
 */

import { createHash } from "node:crypto";
import type { LegalAnswerContextV1 } from "./LegalAnswerContext.js";

export const LEGAL_ANSWER_CITATION_CONTRACT_VERSION = "legal-answer-citation-v1" as const;

export class CitationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CitationError";
  }
}

/** What an answer model is allowed to claim about one citation -- both fields are checked
 *  independently against the context, so a model that gets the fragment right but the
 *  materialization wrong is still rejected (LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 proof 5). */
export interface ClaimedCitation {
  readonly fragment_id: string;
  readonly materialization_id: string;
}

export interface CitationRef {
  readonly contract_version: typeof LEGAL_ANSWER_CITATION_CONTRACT_VERSION;
  readonly citation_id: string;
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly source_provenance_refs: readonly string[];
  readonly rank: number;
  readonly score: number;
  readonly query_run_identity: string;
}

function computeCitationId(fields: {
  fragment_id: string;
  materialization_id: string;
  source_provenance_refs: readonly string[];
  rank: number;
  score: number;
  query_run_identity: string;
}): string {
  const payload = JSON.stringify({
    fragment_id: fields.fragment_id,
    materialization_id: fields.materialization_id,
    source_provenance_refs: [...fields.source_provenance_refs],
    rank: fields.rank,
    score: fields.score,
    query_run_identity: fields.query_run_identity,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Binds a claimed citation to the ONE context entry it must exactly match. Fails closed at every
 * step -- never falls back to "closest match" or "same fragment, ignore the rest":
 *   - fragment_id not present in context.selected  -> CITATION_OUTSIDE_RETRIEVAL_SET
 *   - fragment_id present but materialization_id differs -> CITATION_MATERIALIZATION_MISMATCH
 *   - matched entry has no provenance refs (should be structurally impossible, since
 *     buildLegalAnswerContext already excludes those -- re-checked here as a second, independent
 *     gate) -> MISSING_PROVENANCE
 */
export function buildCitation(claimed: ClaimedCitation, context: LegalAnswerContextV1): CitationRef {
  const entry = context.selected.find((e) => e.fragment_id === claimed.fragment_id);
  if (!entry) {
    throw new CitationError(
      "CITATION_OUTSIDE_RETRIEVAL_SET",
      `CITATION_OUTSIDE_RETRIEVAL_SET: fragment_id=${claimed.fragment_id} is not among this context's selected results -- an answer may cite only what the current retrieval run returned`,
    );
  }
  if (entry.materialization_id !== claimed.materialization_id) {
    throw new CitationError(
      "CITATION_MATERIALIZATION_MISMATCH",
      `CITATION_MATERIALIZATION_MISMATCH: fragment_id=${claimed.fragment_id} belongs to materialization_id=${entry.materialization_id}, not the claimed ${claimed.materialization_id}`,
    );
  }
  if (entry.source_provenance_refs.length === 0) {
    throw new CitationError(
      "MISSING_PROVENANCE",
      `MISSING_PROVENANCE: fragment_id=${claimed.fragment_id} carries no source_provenance_refs -- not admissible for citation`,
    );
  }

  const citation_id = computeCitationId({
    fragment_id: entry.fragment_id,
    materialization_id: entry.materialization_id,
    source_provenance_refs: entry.source_provenance_refs,
    rank: entry.rank,
    score: entry.score,
    query_run_identity: context.query_run_identity,
  });

  return Object.freeze({
    contract_version: LEGAL_ANSWER_CITATION_CONTRACT_VERSION,
    citation_id,
    fragment_id: entry.fragment_id,
    materialization_id: entry.materialization_id,
    source_provenance_refs: entry.source_provenance_refs,
    rank: entry.rank,
    score: entry.score,
    query_run_identity: context.query_run_identity,
  });
}
