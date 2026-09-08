import { describe, expect, it } from 'vitest';

import {
  goldSetHash,
  GoldenCaseError,
  hitAtK,
  mean,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
  validateGoldenCases,
  type GoldenCase,
} from '../src';

describe('K2.2 metrics kernel', () => {
  const rel = [false, true, false, true, false];

  it('hit@k, recall@k (capped), RR and nDCG follow their stated definitions', () => {
    expect(hitAtK(rel, 1)).toBe(0);
    expect(hitAtK(rel, 2)).toBe(1);
    expect(recallAtK(rel, 2, 5)).toBe(1);
    expect(recallAtK(rel, 4, 5)).toBe(0.5);
    expect(recallAtK(rel, 10, 2)).toBe(0.5);
    expect(recallAtK(rel, 0, 5)).toBe(0);
    expect(reciprocalRank(rel)).toBe(0.5);
    expect(reciprocalRank([false, false])).toBe(0);
    expect(ndcgAtK([true], 1, 10)).toBe(1);
    expect(ndcgAtK([false, true], 1, 10)).toBeCloseTo(1 / Math.log2(3), 10);
    expect(ndcgAtK([], 3, 10)).toBe(0);
    expect(mean([])).toBe(0);
    expect(mean([1, 0])).toBe(0.5);
  });

  it('gold-set hash is order-insensitive over cases and sensitive to content', () => {
    const a: GoldenCase = {
      id: 'a',
      category: 'law',
      query: 'q',
      expected: { document_keys: ['x'] },
      notes: 'n',
    };
    const b: GoldenCase = {
      id: 'b',
      category: 'law',
      query: 'q2',
      expected: { document_keys: ['x'] },
      notes: 'n',
    };
    expect(goldSetHash([a, b])).toBe(goldSetHash([b, a]));
    expect(goldSetHash([a, { ...b, query: 'q3' }])).not.toBe(goldSetHash([a, b]));
  });

  it('validates gold structurally: unique ids, exactly one of expected/no-evidence, known keys, reviewable notes', () => {
    const known = new Set(['x']);
    const ok: GoldenCase = {
      id: 'a',
      category: 'law',
      query: 'q',
      expected: { document_keys: ['x'] },
      notes: 'why',
    };
    expect(() => validateGoldenCases([ok], known)).not.toThrow();
    expect(() => validateGoldenCases([ok, ok], known)).toThrow(GoldenCaseError);
    expect(() => validateGoldenCases([{ ...ok, expected: undefined }], known)).toThrow(/exactly one/);
    expect(() => validateGoldenCases([{ ...ok, expects_no_evidence: true }], known)).toThrow(/exactly one/);
    expect(() => validateGoldenCases([{ ...ok, expected: { document_keys: ['nope'] } }], known)).toThrow(
      /unknown document key/,
    );
    expect(() => validateGoldenCases([{ ...ok, notes: ' ' }], known)).toThrow(/reviewable notes/);
  });
});
