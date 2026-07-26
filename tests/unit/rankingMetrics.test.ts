import { describe, test, expect } from 'vitest';
import {
  computeKendallTau,
  computeNDCG,
  computeMRR,
  computeRecallAtK,
} from '../../server/lib/rankingMetrics.ts';

describe('Ranking Metrics', () => {
  describe("Kendall's Tau", () => {
    test('returns 1.0 for identical lists', () => {
      const list = ['a', 'b', 'c', 'd'];
      expect(computeKendallTau(list, list)).toBe(1.0);
    });

    test('returns -1.0 for perfectly reversed lists', () => {
      const pre = ['a', 'b', 'c', 'd'];
      const post = ['d', 'c', 'b', 'a'];
      expect(computeKendallTau(pre, post)).toBe(-1.0);
    });

    test('returns 1.0 for single item or empty lists', () => {
      expect(computeKendallTau([], [])).toBe(1.0);
      expect(computeKendallTau(['a'], ['a'])).toBe(1.0);
    });
  });

  describe('NDCG@K', () => {
    test('returns 1.0 for identical lists', () => {
      const list = ['a', 'b', 'c'];
      expect(computeNDCG(list, list, 3)).toBe(1.0);
    });

    test('handles elements not present in original list with 0 relevance', () => {
      const pre = ['a', 'b'];
      const post = ['c', 'a'];
      expect(computeNDCG(pre, post, 2)).toBeLessThan(1.0);
    });
  });

  describe('Mean Reciprocal Rank (MRR)', () => {
    test('returns 1.0 if pre-list top-1 is also top-1 in post-list', () => {
      const pre = ['a', 'b', 'c'];
      const post = ['a', 'c', 'b'];
      expect(computeMRR(pre, post)).toBe(1.0);
    });

    test('returns 0.5 if pre-list top-1 is second in post-list', () => {
      const pre = ['a', 'b', 'c'];
      const post = ['b', 'a', 'c'];
      expect(computeMRR(pre, post)).toBe(0.5);
    });

    test('returns 0.0 if pre-list top-1 is not found in post-list', () => {
      const pre = ['a', 'b'];
      const post = ['b', 'c'];
      expect(computeMRR(pre, post)).toBe(0.0);
    });
  });

  describe('Recall@K', () => {
    test('returns 1.0 if top-K elements are exactly the same regardless of order', () => {
      const pre = ['a', 'b', 'c'];
      const post = ['c', 'a', 'b'];
      expect(computeRecallAtK(pre, post, 3)).toBe(1.0);
    });

    test('returns partial fraction for partial overlap', () => {
      const pre = ['a', 'b', 'c', 'd'];
      const post = ['a', 'z', 'x', 'y'];
      expect(computeRecallAtK(pre, post, 4)).toBe(0.25);
    });
  });
});
