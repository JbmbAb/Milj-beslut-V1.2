/**
 * LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01, upgraded by LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-
 * ROUTING-01.
 *
 * Deterministic, versioned query routing for law-family retrieval, using metadata already
 * present in the governed corpus (logical_source_id, chapter) instead of a heavier general
 * model. Motivated directly by LEGAL-RETRIEVAL-QUALITY-BASELINE-01's failure-mode evidence: law
 * queries failed almost exclusively via the RIGHT semantic type but the WRONG specific SFS
 * source, or the RIGHT source with the WRONG chapter ranked first -- neither is a citation-
 * lookup problem, so this targets source/chapter narrowing, not lexical/hybrid search.
 *
 * v1 (single-source, first-match-wins) was proven on LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01 to
 * work very well on unambiguous queries (unambiguous MRR 0.484 -> 0.843) but to have a real
 * failure mode on multi-statute queries (H21): a query naming two statutes together got narrowed
 * to only the first-matched one, excluding the source that actually held the correct answer.
 *
 * v2's canonical rule:
 *   0 recognized statutes  -> no source constraint (unchanged from v1)
 *   1 recognized statute   -> source constraint = {that statute} (unchanged from v1)
 *   2+ recognized statutes -> source constraint = {all recognized statutes}, NEVER first-match
 *
 * Hard rule (unchanged from v1): a candidate is only ever added when the query text ITSELF names
 * that statute (well-known unambiguous common name, or explicit SFS number). Never infers "this
 * environmental question is probably about Miljöbalken."
 *
 * Chapter binding is now source-aware, not blindly applied to every candidate: a chapter mention
 * binds only to a specific source if the two are textually adjacent (within a small window, no
 * OTHER recognized source's mention sitting between them) -- "9 kap. miljöbalken och
 * miljöprövningsförordningen" binds chapter 9 to Miljöbalken only, leaving Miljöprövnings-
 * förordningen candidate unrestricted (any chapter), rather than either applying chapter 9 to
 * both or (as v1 did) dropping Miljöprövningsförordningen as a candidate entirely.
 */

export const LAW_SOURCE_ROUTING_VERSION = 'law-source-routing-v2';

interface KnownLawSource {
  readonly logicalSourceId: string;
  readonly sfsNumber: string;
  /** Well-known, unambiguous common-name patterns. Deliberately does NOT include a name pattern
   *  for regeringskansliet-sfs-1998-899 or regeringskansliet-sfs-2011-338: both are titled
   *  "Förordning om miljöfarlig verksamhet och hälsoskydd" (the second adds "(miljötillsyn)"),
   *  genuinely ambiguous by common name alone -- only their SFS number disambiguates, so only
   *  the SFS-number pattern is registered for those two. */
  readonly namePatterns: readonly RegExp[];
}

const KNOWN_LAW_SOURCES: readonly KnownLawSource[] = [
  // Swedish inflection (definite/genitive: -en, -ens, ...) means a trailing \b after the suffix
  // is wrong -- "miljöbalken?\b" does NOT match "miljöbalkens" (the \b fails mid-word before the
  // genitive -s). Matching the bare stem with only a LEADING \b covers every inflected form.
  { logicalSourceId: 'regeringskansliet-sfs-1998-808', sfsNumber: '1998:808', namePatterns: [/\bmiljöbalk/i] },
  { logicalSourceId: 'regeringskansliet-sfs-2013-251', sfsNumber: '2013:251', namePatterns: [/\bmiljöprövningsförordning/i] },
  { logicalSourceId: 'regeringskansliet-sfs-2020-614', sfsNumber: '2020:614', namePatterns: [/\bavfallsförordning/i] },
  { logicalSourceId: 'regeringskansliet-sfs-2010-900', sfsNumber: '2010:900', namePatterns: [/plan-\s*och\s*bygglag/i, /\bPBL\b/] },
  { logicalSourceId: 'regeringskansliet-sfs-2011-338', sfsNumber: '2011:338', namePatterns: [] },
  { logicalSourceId: 'regeringskansliet-sfs-1998-899', sfsNumber: '1998:899', namePatterns: [] },
];

const CHAPTER_PATTERN = /(\d+(?:\s*[a-z])?)\s*kap\.?/gi;
/** How close (chars) a chapter mention must be to a source mention, with nothing else recognized
 *  in between, to be considered "bound" to that specific source rather than left unrestricted. */
const ADJACENCY_WINDOW = 25;

export interface SourceCandidate {
  readonly logicalSourceId: string;
  /** null = this source is an admissible candidate with no chapter restriction (any chapter). */
  readonly chapter_constraint: string | null;
  readonly matched_signal: string;
}

export interface RoutingDecision {
  readonly routing_version: string;
  /** Empty array = no constraint at all (0 recognized statutes) -- search stays unconstrained. */
  readonly source_candidates: readonly SourceCandidate[];
}

interface TextSpan {
  readonly index: number;
  readonly endIndex: number;
}

interface ChapterMention extends TextSpan {
  readonly chapter: string;
}

export interface SourceMention extends TextSpan {
  readonly logicalSourceId: string;
  readonly matched_signal: string;
}

function findChapterMentions(query: string): ChapterMention[] {
  const out: ChapterMention[] = [];
  for (const m of query.matchAll(CHAPTER_PATTERN)) {
    out.push({
      index: m.index!,
      endIndex: m.index! + m[0].length,
      chapter: m[1]!.replace(/\s+/g, ' ').trim().toLowerCase(),
    });
  }
  return out;
}

/** First mention of each known source in the query -- SFS number takes priority over a common
 *  name if both happen to appear (the number is unambiguous, the name might be shared). */
/** Exported for LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01's mention-overlap check -- routing
 *  decisions (routeLawQuery) are entirely unchanged by this; this only exposes the same mention
 *  spans routeLawQuery already computes internally, so the answer layer's generic
 *  "unrecognized statute mention" detector can tell whether a statute-suffix word it found is one
 *  routeLawQuery already recognizes (e.g. "bygglagen" inside "plan- och bygglagen") rather than
 *  re-implementing or drifting from this exact recognition logic. */
export function findSourceMentions(query: string): SourceMention[] {
  const out: SourceMention[] = [];
  for (const src of KNOWN_LAW_SOURCES) {
    const numIdx = query.indexOf(src.sfsNumber);
    if (numIdx !== -1) {
      out.push({ logicalSourceId: src.logicalSourceId, index: numIdx, endIndex: numIdx + src.sfsNumber.length, matched_signal: `sfs_number:${src.sfsNumber}` });
      continue;
    }
    for (const pattern of src.namePatterns) {
      const m = query.match(pattern);
      if (m && m.index !== undefined) {
        out.push({ logicalSourceId: src.logicalSourceId, index: m.index, endIndex: m.index + m[0].length, matched_signal: `name_pattern:${pattern.source}` });
        break;
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** True if `chapter` and `source` sit within ADJACENCY_WINDOW of each other (either order) AND
 *  no OTHER recognized source mention lies textually between them -- this second condition is
 *  what stops "9 kap. miljöbalken och miljöprövningsförordningen" from binding chapter 9 to
 *  Miljöprövningsförordningen just because it happens to also be within a generous window: the
 *  Miljöbalken mention sits between the chapter and it, blocking the bind. */
function chapterBindsToSource(chapter: ChapterMention, source: SourceMention, allSources: readonly SourceMention[]): boolean {
  const gapBefore = source.index - chapter.endIndex; // chapter appears before source
  const gapAfter = chapter.index - source.endIndex; // source appears before chapter (genitive form)
  const adjacent = (gapBefore >= 0 && gapBefore <= ADJACENCY_WINDOW) || (gapAfter >= 0 && gapAfter <= ADJACENCY_WINDOW);
  if (!adjacent) return false;

  const spanStart = Math.min(chapter.index, source.index);
  const spanEnd = Math.max(chapter.endIndex, source.endIndex);
  const blocked = allSources.some(
    (other) => other.logicalSourceId !== source.logicalSourceId && other.index >= spanStart && other.index < spanEnd,
  );
  return !blocked;
}

/** Pure, deterministic, no I/O -- the query text is the only input. */
export function routeLawQuery(query: string): RoutingDecision {
  const sourceMentions = findSourceMentions(query);
  const chapterMentions = findChapterMentions(query);

  const candidates: SourceCandidate[] = sourceMentions.map((source) => {
    const boundChapter = chapterMentions.find((ch) => chapterBindsToSource(ch, source, sourceMentions));
    return {
      logicalSourceId: source.logicalSourceId,
      chapter_constraint: boundChapter ? boundChapter.chapter : null,
      matched_signal: source.matched_signal,
    };
  });

  return Object.freeze({
    routing_version: LAW_SOURCE_ROUTING_VERSION,
    source_candidates: Object.freeze(candidates),
  });
}

/** Human/trace-readable summary of a routing decision, for RetrievalExecutionTrace's
 *  expansion_path -- records the exact source candidate set and per-source chapter constraint,
 *  not just that routing exists as a feature. */
export function describeRoutingDecision(decision: RoutingDecision): string {
  if (decision.source_candidates.length === 0) return `${decision.routing_version}:no_constraint`;
  const parts = decision.source_candidates.map(
    (c) => `${c.logicalSourceId}${c.chapter_constraint ? `[ch.${c.chapter_constraint}]` : '[any]'}`,
  );
  return `${decision.routing_version}:sources=${parts.join('+')}`;
}
