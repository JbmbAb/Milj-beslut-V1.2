import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAppCompletion } from '../../server/services/completionService';
import type { AppCompletionResponse } from '../../types';

describe('server/services/completionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAppCompletion', () => {
    it('returns completion stats object', () => {
      const result = getAppCompletion();

      expect(result).toHaveProperty('donePercent');
      expect(result).toHaveProperty('categories');
      expect(result).toHaveProperty('counts');
    });

    it('calculates done percentage correctly', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      expect(result.donePercent).toBeGreaterThanOrEqual(0);
      expect(result.donePercent).toBeLessThanOrEqual(100);
      expect(result.implementationPercent).toBeGreaterThanOrEqual(result.donePercent);
      expect(result.implementationPercent).toBeLessThanOrEqual(100);
    });

    it('returns feature categories', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      expect(Array.isArray(result.categories)).toBe(true);
      expect(result.categories.length).toBeGreaterThan(0);
    });

    it('each category has required fields', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      for (const category of result.categories) {
        expect(category).toHaveProperty('name');
        expect(category).toHaveProperty('done');
        expect(category).toHaveProperty('total');
        expect(category).toHaveProperty('percent');
      }
    });

    it('category percentages calculated correctly', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      for (const category of result.categories) {
        // The service uses weighted calculation: DONE=1.0, PARTIAL=0.5, PENDING=0.0
        const weightedDone = category.done + (category.partial || 0) * 0.5;
        const expectedPercent = category.total > 0 ? (weightedDone / category.total) * 100 : 0;
        expect(category.percent).toBe(Math.round(expectedPercent));
      }
    });

    it('done count does not exceed total', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      for (const category of result.categories) {
        expect(category.done).toBeLessThanOrEqual(category.total);
      }
    });

    it('handles categories with zero features', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      for (const category of result.categories) {
        expect(Number.isNaN(category.percent)).toBe(false);
      }
    });

    it('reports total counts for done, partial and pending features', () => {
      const result = getAppCompletion() as AppCompletionResponse;

      expect(result.counts.total).toBeGreaterThan(0);
      expect(result.counts.done).toBeGreaterThan(0);
      expect(result.counts.partial).toBeGreaterThan(0);
      expect(result.counts.pending).toBeGreaterThanOrEqual(0);
      expect(result.remainingPercent).toBe(100 - result.donePercent);
    });
  });
});
