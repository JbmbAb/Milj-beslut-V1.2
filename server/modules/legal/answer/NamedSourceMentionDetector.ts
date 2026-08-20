/**
 * LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01.
 *
 * Detects statute-shaped references in a query text that are NOT among LawSourceRouter's known,
 * materialized sources -- e.g. "fiskelagen" in a corpus that only materializes six other statutes.
 * routeLawQuery() alone cannot surface this: it only recognizes the sources it was built to route
 * among, by design (KNOWN_LAW_SOURCES = what this corpus actually materializes), so a query naming
 * a real Swedish statute the corpus simply doesn't have produces zero routing candidates -- exactly
 * as if no statute had been named at all. This module is the other half: a statute-shaped mention
 * that is genuinely unrecognized is itself useful information (the answer layer must not silently
 * answer from a different, unrelated statute instead).
 *
 * Deliberately narrow and lexical, not a general Swedish legal-NER: it matches common Swedish
 * statutory-instrument name suffixes in DEFINITE form (lagen/balken/förordningen/föreskrifterna --
 * the form statutes are actually referred to by in running text, e.g. "miljöbalken", never the bare
 * "miljöbalk"), with a short denylist for known false-positive-prone Swedish words that happen to
 * end the same way (t.ex. "förslaget" ends in "-laget", not a statute). A word already covered by
 * routeLawQuery's own mention detection (checked via real character-span overlap, reusing
 * findSourceMentions -- never a second, potentially-drifting implementation of that recognition)
 * is never reported here twice.
 *
 * This does not claim to catch every possible statute reference -- only the demonstrated pattern
 * class. A statute referred to by an unusual name, acronym, or paraphrase would not be caught;
 * that is an accepted, documented limitation, not a silent gap.
 */

import { findSourceMentions } from "../retrieval/LawSourceRouter";

const STATUTE_SUFFIXES = ["lagen", "balken", "förordningen", "föreskrifterna"] as const;

/** Common Swedish words that happen to end in one of the suffixes above but are never a statute
 *  reference -- kept short and specific, not a general stopword list. */
const SUFFIX_DENYLIST = new Set([
  "förslaget", "förslagen", "underlaget", "underlagen", "omslaget", "omslagen",
  "tillslaget", "tillslagen", "avslaget", "avslagen", "påslaget", "påslagen",
  "beslaget", "beslagen", "anslaget", "anslagen",
]);

const WORD_PATTERN = /[\p{L}-]+/gu;
const SFS_NUMBER_PATTERN = /\b\d{4}:\d+\b/g;

interface Span {
  readonly start: number;
  readonly end: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * Pure, deterministic, no I/O. Returns the raw matched text of every statute-shaped mention in
 * `query` that routeLawQuery's own mention detection does not already recognize.
 */
export function findUnrecognizedStatuteMentions(query: string): readonly string[] {
  const knownSpans: Span[] = findSourceMentions(query).map((m) => ({ start: m.index, end: m.endIndex }));
  const mentions = new Set<string>();

  for (const m of query.matchAll(WORD_PATTERN)) {
    const word = m[0];
    const lower = word.toLowerCase();
    if (SUFFIX_DENYLIST.has(lower)) continue;

    const suffix = STATUTE_SUFFIXES.find((suf) => lower.endsWith(suf) || lower.endsWith(`${suf}s`));
    if (!suffix) continue;

    const stemLength = lower.endsWith(`${suffix}s`) ? lower.length - suffix.length - 1 : lower.length - suffix.length;
    if (stemLength < 2) continue; // no real stem -- reject the bare suffix word itself

    const span: Span = { start: m.index!, end: m.index! + word.length };
    if (knownSpans.some((known) => overlaps(span, known))) continue; // already recognized elsewhere

    mentions.add(word);
  }

  for (const m of query.matchAll(SFS_NUMBER_PATTERN)) {
    const span: Span = { start: m.index!, end: m.index! + m[0].length };
    if (knownSpans.some((known) => overlaps(span, known))) continue;
    mentions.add(m[0]);
  }

  return [...mentions];
}
