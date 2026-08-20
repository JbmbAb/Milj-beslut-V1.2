/**
 * LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01.
 *
 * Closes a distinct, more dangerous gap than a plain semantic miss, found live in
 * LEGAL-ANSWER-PROMPT-CALIBRATION-01 (`NH10`): a query names a statute, the corpus does not
 * materialize that statute, retrieval returns something from an adjacent real statute instead, and
 * the model answered from it without saying a substitution had occurred. The citation was real and
 * well-formed; the answer was simply about the wrong legal source.
 *
 * Canonical invariant:
 *   If the query explicitly names a legal source/statute, the answer layer must verify that the
 *   ADMITTED CONTEXT actually contains that named source before synthesis. A named source absent
 *   from the admitted context must never be silently substituted with another one.
 *
 * This is a PURE decision function -- it takes already-resolved sets (which sources the query
 * names, per an explicit, deterministic name/SFS-identifier match computed elsewhere; which
 * sources are actually present in the admitted context, resolved elsewhere via real materialization
 * metadata) and decides NOT_APPLICABLE / CONSISTENT / NAMED_SOURCE_NOT_AVAILABLE. It never itself
 * inspects query text, infers legal area, or invents a source mapping -- all of that detection work
 * happens in the caller (LegalAnswerComposition.ts + NamedSourceMentionDetector.ts), which is
 * exactly why this function's own inputs are already-resolved id lists, not raw text.
 */

export const NAMED_SOURCE_CONSISTENCY_GATE_VERSION = "named-source-consistency-gate-v1" as const;

export type NamedSourceConsistencyVerdict = "NOT_APPLICABLE" | "CONSISTENT" | "NAMED_SOURCE_NOT_AVAILABLE";

export interface NamedSourceConsistencyInput {
  /** logicalSourceIds the query names AND that are recognized among this corpus's known sources
   *  (e.g. via reusing the frozen law router's own mention detection). */
  readonly namedKnownSourceIds: readonly string[];
  /** Statute-shaped text spans the query names that do NOT match any known source at all -- these
   *  can never be satisfied by any context, since the corpus does not materialize them. */
  readonly unrecognizedStatuteMentions: readonly string[];
  /** logicalSourceIds actually present among the admitted answer context's entries. */
  readonly contextSourceIds: readonly string[];
}

export interface NamedSourceConsistencyResult {
  readonly contract_version: typeof NAMED_SOURCE_CONSISTENCY_GATE_VERSION;
  readonly verdict: NamedSourceConsistencyVerdict;
  readonly named_known_source_ids: readonly string[];
  readonly unrecognized_statute_mentions: readonly string[];
  /** Only populated when verdict=NAMED_SOURCE_NOT_AVAILABLE via a missing KNOWN source (not an
   *  unrecognized mention) -- exactly which named, recognized source(s) the admitted context lacks. */
  readonly missing_source_ids: readonly string[];
  readonly reason: string | null;
}

/**
 * Decision rules, in order:
 *   1. Nothing named at all (no known source, no unrecognized mention) -> NOT_APPLICABLE. The gate
 *      never fabricates a source constraint for a query that didn't name one.
 *   2. Any unrecognized statute-shaped mention -> NAMED_SOURCE_NOT_AVAILABLE immediately. A
 *      statute the corpus never materializes at all can never be satisfied by any context.
 *   3. One or more named KNOWN sources, all present among contextSourceIds -> CONSISTENT.
 *   4. One or more named KNOWN sources, at least one absent from contextSourceIds ->
 *      NAMED_SOURCE_NOT_AVAILABLE. ALL named sources must be accounted for -- a query naming two
 *      statutes where only one was actually retrieved is exactly the substitution this gate exists
 *      to catch, not a case to silently narrow.
 */
export function evaluateNamedSourceConsistency(input: NamedSourceConsistencyInput): NamedSourceConsistencyResult {
  const named_known_source_ids = Object.freeze([...input.namedKnownSourceIds]);
  const unrecognized_statute_mentions = Object.freeze([...input.unrecognizedStatuteMentions]);

  if (named_known_source_ids.length === 0 && unrecognized_statute_mentions.length === 0) {
    return Object.freeze({
      contract_version: NAMED_SOURCE_CONSISTENCY_GATE_VERSION,
      verdict: "NOT_APPLICABLE",
      named_known_source_ids,
      unrecognized_statute_mentions,
      missing_source_ids: Object.freeze([]),
      reason: null,
    });
  }

  if (unrecognized_statute_mentions.length > 0) {
    return Object.freeze({
      contract_version: NAMED_SOURCE_CONSISTENCY_GATE_VERSION,
      verdict: "NAMED_SOURCE_NOT_AVAILABLE",
      named_known_source_ids,
      unrecognized_statute_mentions,
      missing_source_ids: Object.freeze([]),
      reason: `query names a statute-shaped reference (${unrecognized_statute_mentions.join(", ")}) not recognized among this corpus's known sources`,
    });
  }

  const missing = named_known_source_ids.filter((id) => !input.contextSourceIds.includes(id));
  if (missing.length > 0) {
    return Object.freeze({
      contract_version: NAMED_SOURCE_CONSISTENCY_GATE_VERSION,
      verdict: "NAMED_SOURCE_NOT_AVAILABLE",
      named_known_source_ids,
      unrecognized_statute_mentions,
      missing_source_ids: Object.freeze(missing),
      reason: `named source(s) not present in the admitted context: ${missing.join(", ")}`,
    });
  }

  return Object.freeze({
    contract_version: NAMED_SOURCE_CONSISTENCY_GATE_VERSION,
    verdict: "CONSISTENT",
    named_known_source_ids,
    unrecognized_statute_mentions,
    missing_source_ids: Object.freeze([]),
    reason: null,
  });
}
