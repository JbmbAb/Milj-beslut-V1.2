/**
 * LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01.
 *
 * A separate contract gap from evidence sufficiency: the system can have real, on-topic evidence
 * and still be looking at a query too underspecified to produce a useful answer from
 * ("Vad gäller?" -- observed directly in LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01's battery,
 * where the model answered with technically-real but practically non-responsive citations rather
 * than recognizing the question itself carried no content to anchor to).
 *
 * This gate runs BEFORE retrieval and BEFORE answer synthesis, and deliberately does none of:
 *   - infer subject, legal area, or source from the query
 *   - consult retrieval results, context, or any DB state
 *   - use an LLM call of any kind
 *
 * It is a small, purely lexical, deterministic, versioned check on the query string alone: does it
 * carry at least one content-bearing term once common Swedish function/question words are removed?
 * That is the ENTIRE claim this gate makes -- it is not a query-quality classifier, not a topic
 * detector, and not a substitute for INSUFFICIENT_EVIDENCE (which is decided later, after real
 * retrieval, by whether the actual evidence found supports an answer).
 */

export const QUERY_SPECIFICITY_GATE_VERSION = "query-specificity-gate-v1" as const;

export type QuerySpecificityVerdict = "SPECIFIED" | "UNDERSPECIFIED";

export interface QuerySpecificityResult {
  readonly contract_version: typeof QUERY_SPECIFICITY_GATE_VERSION;
  readonly verdict: QuerySpecificityVerdict;
  readonly content_word_count: number;
  readonly reason: string | null;
}

/** Common Swedish function/question words -- deliberately closed and small. This is NOT a
 *  stopword list tuned for search relevance; it exists only to strip words that carry no content
 *  of their own, so what remains is a rough, honest count of terms the query actually asks about.
 *  Never extended with domain/legal-source vocabulary -- that would smuggle topic inference in. */
const STOPWORDS = new Set([
  "vad", "vem", "vilka", "vilken", "vilket", "vilkas", "hur", "när", "var", "vart", "varför", "varifrån",
  "är", "det", "den", "de", "denna", "detta", "dessa", "att", "och", "eller", "men", "så", "att",
  "en", "ett", "om", "för", "av", "till", "med", "på", "i", "ur", "som", "man", "du", "jag", "vi", "ni",
  "de", "han", "hon", "kan", "ska", "skall", "får", "bör", "sig", "sin", "sitt", "sina", "har", "hade",
  "vara", "blir", "blev", "inte", "ej", "också", "bara", "än", "då", "här", "där", "nu", "gäller",
  "finns", "göra", "gör", "gjort", "kring", "över", "under", "mellan", "samt", "både", "alla", "allt",
]);

function tokenize(query: string): readonly string[] {
  return query
    .toLowerCase()
    .replace(/[.,!?;:()"'"'”’«»]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Pure, deterministic, and versioned: the same query string always produces the same verdict.
 * `content_word_count` is reported alongside the verdict so callers/traces can audit exactly why a
 * query was judged underspecified, rather than trusting a bare boolean.
 */
export function evaluateQuerySpecificity(query: string): QuerySpecificityResult {
  const words = tokenize(query.trim());
  const contentWords = words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  const verdict: QuerySpecificityVerdict = contentWords.length === 0 ? "UNDERSPECIFIED" : "SPECIFIED";

  return Object.freeze({
    contract_version: QUERY_SPECIFICITY_GATE_VERSION,
    verdict,
    content_word_count: contentWords.length,
    reason:
      verdict === "UNDERSPECIFIED"
        ? "no content-bearing terms remain after removing common Swedish function/question words -- the query carries nothing to anchor an answer to, independent of whatever evidence retrieval might find"
        : null,
  });
}
