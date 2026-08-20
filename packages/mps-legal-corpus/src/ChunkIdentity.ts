import { createHash } from 'node:crypto';
import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';

/**
 * LEGAL-CHUNK-IDENTITY-V2.
 *
 * Supersedes the v1 shape that forced every document family into SFS-shaped
 * `chapter: number` / `paragraph: string` identity. Two defects that fix closed:
 *
 *   1. `chapter` as `number` cannot represent a real Swedish law citation like "2 a kap." —
 *      coercing it would silently lose the citation, not just reformat it.
 *   2. Mandatory chapter/paragraph on every family forced non-law documents (court decisions,
 *      agency guidance, anything chunked as `standard`) to either fabricate structure they do
 *      not have, or be wrongly rejected for lacking structure that was never theirs to have.
 *
 * `structure_kind` is exactly the four chunking strategies the chunking-strategy-gate skill
 * already governs (`law | court | evidence | standard`) — identity follows chunking strategy,
 * not the other way around. Each family carries only the structural anchor it can honestly
 * verify; `sequence` (not chapter/paragraph) is the universal deterministic ordering key.
 *
 * Only identity-bearing fields participate in a chunk's content identity. Deliberately excludes
 * `embedding_status`/`embedding_vector` and all timestamps — same rule already established in
 * `packages/mps-core/src/types.ts`. Reused here, not reinvented.
 */
export type ChunkStructureKind = 'law' | 'court' | 'evidence' | 'standard';

interface LegalChunkIdentityBase {
  readonly fragment_id: string;
  readonly structure_kind: ChunkStructureKind;
  /** Deterministic position within this exact governed projection + chunk policy. */
  readonly sequence: number;
  readonly chunk_policy_version: string;
  /** Binds this chunk to the exact governed projected source it was derived from. */
  readonly source_projection_ref: string;
  readonly full_text: string;
  readonly title?: string;
  readonly references_to: readonly string[];
  readonly case_citations: readonly string[];
}

export interface LawChunkIdentityFields extends LegalChunkIdentityBase {
  readonly structure_kind: 'law';
  /** e.g. "2", "2 a" — the verified citation text, never a fabricated default. */
  readonly chapter: string;
  readonly paragraph: string;
  readonly section?: string;
}

export interface CourtChunkIdentityFields extends LegalChunkIdentityBase {
  readonly structure_kind: 'court';
  /** e.g. DOMSLUT | DOMSKÄL | YRKANDEN | BAKGRUND | SKÄL | ÖVRIGT — from chunkCourtDecision. */
  readonly court_section: string;
}

export interface EvidenceChunkIdentityFields extends LegalChunkIdentityBase {
  readonly structure_kind: 'evidence';
  /** Only set when the evidence chunker itself produces a verifiable anchor — never invented
   *  for symmetry with the other families. */
  readonly evidence_anchor?: string;
}

export interface StandardChunkIdentityFields extends LegalChunkIdentityBase {
  readonly structure_kind: 'standard';
  // No structural anchor beyond `sequence` — the honest fallback shape. `standard` chunks are
  // not "law chunks without paragraphs"; they are their own kind with no fabricated anchor.
}

export type LegalChunkIdentityFields =
  | LawChunkIdentityFields
  | CourtChunkIdentityFields
  | EvidenceChunkIdentityFields
  | StandardChunkIdentityFields;

export class ChunkOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkOrderError';
  }
}

export class ChunkFamilyMixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkFamilyMixError';
  }
}

/**
 * Numeric-aware string comparator. Plain string comparison would sort "34:10" before "34:2"
 * (lexicographic), which is not a stable, meaningful document order — and would sort "2 a kap."
 * arbitrarily against "10 kap." Extracts a leading integer run and compares numerically; falls
 * back to locale string comparison for any non-numeric remainder (handles suffixes like "2 a").
 * Used for both `chapter` and `paragraph` — the same numeric-aware rule applies to each.
 */
export function compareParagraph(a: string, b: string): number {
  const pattern = /^(\d+)(.*)$/;
  const matchA = a.match(pattern);
  const matchB = b.match(pattern);
  if (matchA && matchB) {
    const numA = parseInt(matchA[1], 10);
    const numB = parseInt(matchB[1], 10);
    if (numA !== numB) return numA - numB;
    return matchA[2].localeCompare(matchB[2]);
  }
  return a.localeCompare(b);
}

/**
 * The canonical document-structure order.
 *
 * `law`: (chapter, then paragraph — both numeric-aware), fragment_id tiebreak. `court` /
 * `evidence` / `standard`: (sequence), fragment_id tiebreak — these families have no chapter/
 * paragraph to order by, and `sequence` is exactly the deterministic position the chunking
 * pipeline already assigned. A chunk set mixing structure kinds has no defined order at all —
 * that is a producer bug, not something to silently order around, so it is rejected instead of
 * guessed at.
 */
function canonicalComparator(a: LegalChunkIdentityFields, b: LegalChunkIdentityFields): number {
  if (a.structure_kind !== b.structure_kind) {
    throw new ChunkFamilyMixError(
      `Cannot order a chunk set mixing structure_kind '${a.structure_kind}' and '${b.structure_kind}' — ` +
        'a single document has one classification, and canonical order is defined per family.',
    );
  }
  if (a.structure_kind === 'law' && b.structure_kind === 'law') {
    const chapterCompare = compareParagraph(a.chapter, b.chapter);
    if (chapterCompare !== 0) return chapterCompare;
    const paragraphCompare = compareParagraph(a.paragraph, b.paragraph);
    if (paragraphCompare !== 0) return paragraphCompare;
    return a.fragment_id.localeCompare(b.fragment_id);
  }
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  return a.fragment_id.localeCompare(b.fragment_id);
}

/**
 * Convenience for PRODUCERS (the chunking pipeline, test fixtures) constructing a chunk array:
 * returns a new array sorted into canonical document-structure order. This sort function is
 * itself part of `pipeline_version`'s contract — changing it is a pipeline change. NOT called
 * automatically by `computeChunkSetContentHash` below (see its docstring for why) — callers
 * must order their own output explicitly.
 */
export function orderChunksDeterministically<T extends LegalChunkIdentityFields>(
  chunks: readonly T[],
): T[] {
  return [...chunks].sort(canonicalComparator);
}

/** True iff `chunks` is already in canonical document-structure order. Does not mutate. Throws
 *  `ChunkFamilyMixError` for a mixed-family input, same as the comparator it uses. */
export function isCanonicallyOrdered(chunks: readonly LegalChunkIdentityFields[]): boolean {
  for (let i = 1; i < chunks.length; i++) {
    if (canonicalComparator(chunks[i - 1], chunks[i]) > 0) return false;
  }
  return true;
}

function extractIdentityFields(chunk: LegalChunkIdentityFields): Record<string, unknown> {
  const base = {
    fragment_id: chunk.fragment_id,
    structure_kind: chunk.structure_kind,
    sequence: chunk.sequence,
    chunk_policy_version: chunk.chunk_policy_version,
    source_projection_ref: chunk.source_projection_ref,
    full_text: chunk.full_text,
    title: chunk.title ?? null,
    references_to: [...chunk.references_to],
    case_citations: [...chunk.case_citations],
  };
  if (chunk.structure_kind === 'law') {
    return { ...base, chapter: chunk.chapter, paragraph: chunk.paragraph, section: chunk.section ?? null };
  }
  if (chunk.structure_kind === 'court') {
    return { ...base, court_section: chunk.court_section };
  }
  if (chunk.structure_kind === 'evidence') {
    return { ...base, evidence_anchor: chunk.evidence_anchor ?? null };
  }
  return base;
}

/**
 * `chunk_set_content_hash` — hash over EXACTLY the bytes verification must later reproduce.
 *
 * Deliberately order-SENSITIVE and deliberately does NOT silently re-sort its input: the same
 * chunks in a different order must NOT produce the same identity. Auto-sorting here would
 * defeat that. Instead: this function requires the input to already be in canonical order
 * (`isCanonicallyOrdered`) and throws `ChunkOrderError` if it isn't; a mixed-family input throws
 * `ChunkFamilyMixError` (propagated from the comparator).
 *
 * `canonicalizeStrict` (RFC 8785) normalizes object key order within each chunk, but does NOT
 * reorder arrays — the array order must already be correct before this call.
 *
 * Returns bare hex, matching the existing `content_hash` convention elsewhere in this codebase.
 */
export function computeChunkSetContentHash(chunks: readonly LegalChunkIdentityFields[]): string {
  if (!isCanonicallyOrdered(chunks)) {
    throw new ChunkOrderError(
      'Chunk array is not in canonical document-structure order (law: chapter, then paragraph, ' +
        'both numeric-aware; other families: sequence — then fragment_id tiebreak in all cases). ' +
        'chunk_set_content_hash is order-sensitive by design — the same chunks in a different ' +
        'order must not silently produce the same identity. Call orderChunksDeterministically() ' +
        'before computing the hash.',
    );
  }
  const identityArray = chunks.map(extractIdentityFields);
  return createHash('sha256').update(canonicalizeStrict(identityArray), 'utf-8').digest('hex');
}

/**
 * The one producer of `fragment_id`. Not a free-standing truth claim: two chunks with the same
 * family-specific anchor and sequence but a DIFFERENT governed projection or chunk policy (e.g.
 * a re-chunk after a rule fix, or a re-projection after a source update) must never collide on
 * fragment_id, and the same governed input re-chunked identically must always reproduce the
 * same fragment_id (replay). Binds: source_projection_ref, chunk_policy_version, structure_kind,
 * the family's own anchor, sequence, and a hash of full_text (so an edited paragraph at the same
 * citation still gets a distinct fragment identity).
 */
export function computeFragmentId(
  fields: Omit<LegalChunkIdentityFields, 'fragment_id'>,
): string {
  const anchor =
    fields.structure_kind === 'law'
      ? `${fields.chapter}:${fields.paragraph}:${fields.section ?? ''}`
      : fields.structure_kind === 'court'
        ? fields.court_section
        : fields.structure_kind === 'evidence'
          ? (fields.evidence_anchor ?? '')
          : '';

  const payload = {
    source_projection_ref: fields.source_projection_ref,
    chunk_policy_version: fields.chunk_policy_version,
    structure_kind: fields.structure_kind,
    anchor,
    sequence: fields.sequence,
    content_hash: createHash('sha256').update(fields.full_text, 'utf8').digest('hex'),
  };
  const digest = createHash('sha256').update(canonicalizeStrict(payload), 'utf8').digest('hex');
  return `frag:${digest}`;
}
