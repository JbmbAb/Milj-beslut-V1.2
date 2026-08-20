/**
 * LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01.
 *
 * Deterministic, versioned query routing for law-family retrieval, using metadata already
 * present in the governed corpus (logical_source_id, chapter) instead of a heavier general
 * model. Motivated directly by LEGAL-RETRIEVAL-QUALITY-BASELINE-01's failure-mode evidence: law
 * queries failed almost exclusively via the RIGHT semantic type but the WRONG specific SFS
 * source, or the RIGHT source with the WRONG chapter ranked first -- neither is a citation-
 * lookup problem, so this targets source/chapter narrowing, not lexical/hybrid search.
 *
 * Hard rule: a constraint is only ever applied when the query text ITSELF names a statute (by a
 * well-known, unambiguous common name, or by explicit SFS number) or explicit chapter. This
 * module never infers "this environmental question is probably about Miljöbalken" -- a query
 * with no such signal gets `source_constraint: null` and searches the full, unconstrained
 * candidate set exactly as before. Fabricating a constraint would silently narrow (and could
 * wrongly exclude) the correct answer.
 *
 * A chapter constraint is only ever returned ALONGSIDE a source constraint -- a chapter number
 * alone ("7 kap.") is meaningless without knowing which statute it belongs to, so it is never
 * applied on its own.
 */

export const LAW_SOURCE_ROUTING_VERSION = 'law-source-routing-v1';

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

const CHAPTER_PATTERN = /\b(\d+(?:\s*[a-z])?)\s*kap\.?/i;

export interface RoutingDecision {
  readonly routing_version: string;
  readonly source_constraint: string | null;
  readonly chapter_constraint: string | null;
  readonly matched_signal: string | null;
}

/** Pure, deterministic, no I/O -- the query text is the only input. */
export function routeLawQuery(query: string): RoutingDecision {
  let source_constraint: string | null = null;
  let matched_signal: string | null = null;

  for (const src of KNOWN_LAW_SOURCES) {
    if (query.includes(src.sfsNumber)) {
      source_constraint = src.logicalSourceId;
      matched_signal = `sfs_number:${src.sfsNumber}`;
      break;
    }
  }
  if (!source_constraint) {
    for (const src of KNOWN_LAW_SOURCES) {
      const hit = src.namePatterns.find((p) => p.test(query));
      if (hit) {
        source_constraint = src.logicalSourceId;
        matched_signal = `name_pattern:${hit.source}`;
        break;
      }
    }
  }

  let chapter_constraint: string | null = null;
  if (source_constraint) {
    const chapMatch = query.match(CHAPTER_PATTERN);
    if (chapMatch?.[1]) {
      chapter_constraint = chapMatch[1].replace(/\s+/g, ' ').trim().toLowerCase();
    }
  }

  return Object.freeze({
    routing_version: LAW_SOURCE_ROUTING_VERSION,
    source_constraint,
    chapter_constraint,
    matched_signal,
  });
}

/** Human/trace-readable summary of a routing decision, for RetrievalExecutionTrace's
 *  expansion_path -- so the trace records exactly which routing/filter decision was applied,
 *  not just that routing exists as a feature. */
export function describeRoutingDecision(decision: RoutingDecision): string {
  if (!decision.source_constraint) return `${decision.routing_version}:no_constraint`;
  const parts = [`${decision.routing_version}:source=${decision.source_constraint}`];
  if (decision.chapter_constraint) parts.push(`chapter=${decision.chapter_constraint}`);
  return parts.join(',');
}
