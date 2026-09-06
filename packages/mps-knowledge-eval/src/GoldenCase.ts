import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import type { RetrievalFilters } from '@miljobeslut/mps-knowledge-index';

/**
 * Gold is source-backed and content-bound. A case never names a database id: it names fixture
 * DOCUMENT KEYS (stable labels resolved to content-derived document_ids when the fixture corpus is
 * built) and STRUCTURAL predicates (chapter/paragraph, court section, evidence anchor, literal
 * text) over governed chunks. Every case carries reviewable `notes` explaining why the expectation
 * is right, with the source it rests on.
 */
export type ChunkPredicate =
  | { readonly kind: 'law'; readonly chapter: string; readonly paragraph?: string }
  | { readonly kind: 'court_section'; readonly section: string }
  | { readonly kind: 'evidence_anchor'; readonly anchor: string }
  | { readonly kind: 'text_contains'; readonly text: string };

export type GoldenCategory =
  | 'law'
  | 'ordinance'
  | 'court'
  | 'decision'
  | 'mkb'
  | 'technical'
  | 'control'
  | 'guidance'
  | 'version'
  | 'abstention'
  | 'adversarial';

export interface GoldenExpectation {
  /** Acceptable documents (fixture keys). A hit outside this set is not relevant. */
  readonly document_keys: readonly string[];
  /** If present, a hit must additionally satisfy at least one predicate to count as relevant. */
  readonly chunk_predicates?: readonly ChunkPredicate[];
}

export interface GoldenCase {
  readonly id: string;
  readonly category: GoldenCategory;
  readonly query: string;
  readonly expected?: GoldenExpectation;
  /** The knowledge layer must return NO_EVIDENCE for this query. */
  readonly expects_no_evidence?: boolean;
  /** Any hit from these documents/sources fails the case, regardless of ranking. */
  readonly exclusions?: {
    readonly document_keys?: readonly string[];
    readonly source_ids?: readonly string[];
  };
  /** Metadata narrowing applied in `narrowed` mode; ignored in `unrestricted` (baseline) mode. */
  readonly filters?: RetrievalFilters;
  /** Top-k rank within which a relevant hit must appear for the case to PASS (default 5). */
  readonly required_hit_within?: number;
  readonly notes: string;
}

export function goldSetHash(cases: readonly GoldenCase[]): string {
  return createHash('sha256')
    .update(canonicalizeStrict([...cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))), 'utf8')
    .digest('hex');
}

export class GoldenCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldenCaseError';
  }
}

/** Structural validation of a gold set: unique ids, exactly one of expected/expects_no_evidence, known keys. */
export function validateGoldenCases(
  cases: readonly GoldenCase[],
  knownDocumentKeys: ReadonlySet<string>,
): void {
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new GoldenCaseError(`duplicate golden case id '${c.id}'`);
    ids.add(c.id);
    if (!c.query.trim()) throw new GoldenCaseError(`case '${c.id}' has an empty query`);
    if (!c.notes.trim()) throw new GoldenCaseError(`case '${c.id}' has no reviewable notes`);
    if (Boolean(c.expected) === Boolean(c.expects_no_evidence)) {
      throw new GoldenCaseError(`case '${c.id}' must declare exactly one of expected / expects_no_evidence`);
    }
    for (const key of [...(c.expected?.document_keys ?? []), ...(c.exclusions?.document_keys ?? [])]) {
      if (!knownDocumentKeys.has(key))
        throw new GoldenCaseError(`case '${c.id}' references unknown document key '${key}'`);
    }
    if (c.expected && c.expected.document_keys.length === 0)
      throw new GoldenCaseError(`case '${c.id}' expects no documents`);
  }
}
