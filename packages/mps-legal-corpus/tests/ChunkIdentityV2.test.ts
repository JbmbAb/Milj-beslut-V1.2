import { describe, expect, it } from 'vitest';
import {
  ChunkFamilyMixError,
  ChunkOrderError,
  compareParagraph,
  computeChunkSetContentHash,
  computeFragmentId,
  isCanonicallyOrdered,
  orderChunksDeterministically,
  type CourtChunkIdentityFields,
  type LawChunkIdentityFields,
  type LegalChunkIdentityFields,
  type StandardChunkIdentityFields,
} from '../src/index';

/**
 * LEGAL-CHUNK-IDENTITY-V2.
 *
 * Proves the discriminated-union identity model: chapter/paragraph are strings (never coerced
 * to number, so "2 a kap." survives intact), only `law` requires them, `sequence` is the
 * universal ordering key for everything else, fragment_id is derived (not a free-standing
 * claim), and identity is bound to the exact governed projection + chunk policy.
 */
const PROJECTION_A = 'sha256:projection-a';
const PROJECTION_B = 'sha256:projection-b';
const POLICY_V1 = 'legal-chunker-v2.3';
const POLICY_V2 = 'legal-chunker-v2.4';

function lawChunk(
  overrides: Partial<LawChunkIdentityFields> = {},
): LawChunkIdentityFields {
  const base: Omit<LawChunkIdentityFields, 'fragment_id'> = {
    structure_kind: 'law',
    chapter: '2',
    paragraph: '1',
    full_text: 'Text.',
    references_to: [],
    case_citations: [],
    chunk_policy_version: POLICY_V1,
    source_projection_ref: PROJECTION_A,
    sequence: 0,
    ...overrides,
  };
  return { ...base, fragment_id: computeFragmentId(base) };
}

function courtChunk(
  overrides: Partial<CourtChunkIdentityFields> = {},
): CourtChunkIdentityFields {
  const base: Omit<CourtChunkIdentityFields, 'fragment_id'> = {
    structure_kind: 'court',
    court_section: 'DOMSLUT',
    full_text: 'Domslutstext.',
    references_to: [],
    case_citations: [],
    chunk_policy_version: POLICY_V1,
    source_projection_ref: PROJECTION_A,
    sequence: 0,
    ...overrides,
  };
  return { ...base, fragment_id: computeFragmentId(base) };
}

function standardChunk(
  overrides: Partial<StandardChunkIdentityFields> = {},
): StandardChunkIdentityFields {
  const base: Omit<StandardChunkIdentityFields, 'fragment_id'> = {
    structure_kind: 'standard',
    full_text: 'Vägledningstext.',
    references_to: [],
    case_citations: [],
    chunk_policy_version: POLICY_V1,
    source_projection_ref: PROJECTION_A,
    sequence: 0,
    ...overrides,
  };
  return { ...base, fragment_id: computeFragmentId(base) };
}

describe('ChunkIdentity v2 — chapter is never coerced', () => {
  it('preserves a real letter-suffixed chapter citation ("2 a") through identity and ordering', () => {
    const c2 = lawChunk({ chapter: '2', paragraph: '1', sequence: 0 });
    const c2a = lawChunk({ chapter: '2 a', paragraph: '1', sequence: 1 });
    const c3 = lawChunk({ chapter: '3', paragraph: '1', sequence: 2 });

    expect(c2a.chapter).toBe('2 a');
    const ordered = orderChunksDeterministically([c3, c2a, c2]);
    expect(ordered.map((c) => c.chapter)).toEqual(['2', '2 a', '3']);
  });
});

describe('ChunkIdentity v2 — structure_kind-aware admission shape', () => {
  it('court chunks have no chapter/paragraph fields at all — not "0", absent', () => {
    const c = courtChunk();
    expect('chapter' in c).toBe(false);
    expect('paragraph' in c).toBe(false);
    expect(c.court_section).toBe('DOMSLUT');
  });

  it('standard chunks carry only sequence, no fabricated structural anchor', () => {
    const c = standardChunk();
    expect('chapter' in c).toBe(false);
    expect('court_section' in c).toBe(false);
    expect('evidence_anchor' in c).toBe(false);
  });
});

describe('ChunkIdentity v2 — ordering', () => {
  it('law family orders by chapter then paragraph, both numeric-aware', () => {
    const c1 = lawChunk({ chapter: '34', paragraph: '2', sequence: 0 });
    const c2 = lawChunk({ chapter: '34', paragraph: '10', sequence: 1 });
    expect(isCanonicallyOrdered([c1, c2])).toBe(true);
    expect(isCanonicallyOrdered([c2, c1])).toBe(false);
    expect(orderChunksDeterministically([c2, c1]).map((c) => c.paragraph)).toEqual(['2', '10']);
  });

  it('non-law families order strictly by sequence', () => {
    const first = courtChunk({ court_section: 'BAKGRUND', sequence: 0 });
    const second = courtChunk({ court_section: 'DOMSKAL', sequence: 1 });
    const third = courtChunk({ court_section: 'DOMSLUT', sequence: 2 });
    expect(isCanonicallyOrdered([first, second, third])).toBe(true);
    expect(isCanonicallyOrdered([third, second, first])).toBe(false);
  });

  it('a chunk set mixing structure_kind has no defined order and is rejected, not silently ordered', () => {
    const mixed: LegalChunkIdentityFields[] = [lawChunk(), courtChunk()];
    expect(() => isCanonicallyOrdered(mixed)).toThrow(ChunkFamilyMixError);
    expect(() => orderChunksDeterministically(mixed)).toThrow(ChunkFamilyMixError);
  });

  it('an out-of-order chunk set still fails closed at hash time', () => {
    const c1 = lawChunk({ chapter: '34', paragraph: '2', sequence: 0 });
    const c2 = lawChunk({ chapter: '34', paragraph: '10', sequence: 1 });
    expect(() => computeChunkSetContentHash([c2, c1])).toThrow(ChunkOrderError);
  });
});

describe('ChunkIdentity v2 — projection/policy binding', () => {
  it('identical chunks under a different governed projection produce a different chunk_set_content_hash', () => {
    const underA = [lawChunk({ source_projection_ref: PROJECTION_A })];
    const underB = [lawChunk({ source_projection_ref: PROJECTION_B })];
    expect(computeChunkSetContentHash(underA)).not.toBe(computeChunkSetContentHash(underB));
  });

  it('identical chunks under a different chunk policy version produce a different chunk_set_content_hash', () => {
    const underV1 = [lawChunk({ chunk_policy_version: POLICY_V1 })];
    const underV2 = [lawChunk({ chunk_policy_version: POLICY_V2 })];
    expect(computeChunkSetContentHash(underV1)).not.toBe(computeChunkSetContentHash(underV2));
  });

  it('identical governed input reproduces the identical chunk_set_content_hash (replay)', () => {
    const run1 = [lawChunk({ chapter: '2', paragraph: '1' })];
    const run2 = [lawChunk({ chapter: '2', paragraph: '1' })];
    expect(computeChunkSetContentHash(run1)).toBe(computeChunkSetContentHash(run2));
  });
});

describe('ChunkIdentity v2 — computeFragmentId is a derived value, not a free-standing claim', () => {
  it('same governed input (projection + policy + anchor + sequence + content) -> same fragment_id', () => {
    const fields: Omit<LawChunkIdentityFields, 'fragment_id'> = {
      structure_kind: 'law', chapter: '2', paragraph: '1', full_text: 'Text.',
      references_to: [], case_citations: [], chunk_policy_version: POLICY_V1,
      source_projection_ref: PROJECTION_A, sequence: 0,
    };
    expect(computeFragmentId(fields)).toBe(computeFragmentId({ ...fields }));
  });

  it('a different projection (a re-fetched/updated source) changes fragment_id even for the same anchor/text', () => {
    const base = {
      structure_kind: 'law' as const, chapter: '2', paragraph: '1', full_text: 'Text.',
      references_to: [], case_citations: [], chunk_policy_version: POLICY_V1, sequence: 0,
    };
    const a = computeFragmentId({ ...base, source_projection_ref: PROJECTION_A });
    const b = computeFragmentId({ ...base, source_projection_ref: PROJECTION_B });
    expect(a).not.toBe(b);
  });

  it('changed content at the SAME citation changes fragment_id — two versions of the same paragraph never collide', () => {
    const base = {
      structure_kind: 'law' as const, chapter: '2', paragraph: '1',
      references_to: [], case_citations: [], chunk_policy_version: POLICY_V1,
      source_projection_ref: PROJECTION_A, sequence: 0,
    };
    const original = computeFragmentId({ ...base, full_text: 'Original text.' });
    const amended = computeFragmentId({ ...base, full_text: 'Amended text.' });
    expect(original).not.toBe(amended);
  });

  it('is not a random value and not a naive "law-2-1" string — it is a derived hash', () => {
    const fields: Omit<LawChunkIdentityFields, 'fragment_id'> = {
      structure_kind: 'law', chapter: '2', paragraph: '1', full_text: 'Text.',
      references_to: [], case_citations: [], chunk_policy_version: POLICY_V1,
      source_projection_ref: PROJECTION_A, sequence: 0,
    };
    const id = computeFragmentId(fields);
    expect(id).toMatch(/^frag:[0-9a-f]{64}$/);
  });
});

describe('ChunkIdentity v2 — compareParagraph (reused for chapter and paragraph alike)', () => {
  it('"34:10" sorts after "34:2"', () => {
    expect(compareParagraph('2', '10')).toBeLessThan(0);
    expect(compareParagraph('10', '2')).toBeGreaterThan(0);
  });
});
