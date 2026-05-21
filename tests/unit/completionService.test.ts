import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => vi.resetAllMocks());

// completionService has module-level state (FEATURES array), but it is
// immutable — reset between tests is not required. We import statically.
import { getAppCompletion } from '../../server/services/completionService';

describe('getAppCompletion', () => {
  it('returns an object with required top-level fields', () => {
    const result = getAppCompletion();

    expect(result).toHaveProperty('checkedAt');
    expect(result).toHaveProperty('donePercent');
    expect(result).toHaveProperty('implementationPercent');
    expect(result).toHaveProperty('remainingPercent');
    expect(result).toHaveProperty('counts');
    expect(result).toHaveProperty('categories');
  });

  it('checkedAt is a valid ISO date string', () => {
    const { checkedAt } = getAppCompletion();
    expect(() => new Date(checkedAt)).not.toThrow();
    expect(new Date(checkedAt).toISOString()).toBe(checkedAt);
  });

  it('donePercent + remainingPercent equals 100', () => {
    const { donePercent, remainingPercent } = getAppCompletion();
    expect(donePercent + remainingPercent).toBe(100);
  });

  it('donePercent is between 0 and 100', () => {
    const { donePercent } = getAppCompletion();
    expect(donePercent).toBeGreaterThanOrEqual(0);
    expect(donePercent).toBeLessThanOrEqual(100);
  });

  it('counts.total equals done + partial + pending', () => {
    const { counts } = getAppCompletion();
    expect(counts.total).toBe(counts.done + counts.partial + counts.pending);
  });

  it('counts.total matches the number of features across all categories', () => {
    const { counts, categories } = getAppCompletion();
    const totalFromCategories = categories.reduce((sum, c) => sum + c.total, 0);
    expect(counts.total).toBe(totalFromCategories);
  });

  it('each category has a percent between 0 and 100', () => {
    const { categories } = getAppCompletion();
    for (const cat of categories) {
      expect(cat.percent).toBeGreaterThanOrEqual(0);
      expect(cat.percent).toBeLessThanOrEqual(100);
    }
  });

  it('each category totals match its feature array length', () => {
    const { categories } = getAppCompletion();
    for (const cat of categories) {
      expect(cat.features).toHaveLength(cat.total);
      expect(cat.done + cat.partial + cat.pending).toBe(cat.total);
    }
  });

  it('every feature has a non-empty id, label, category, and valid status', () => {
    const { categories } = getAppCompletion();
    const validStatuses = new Set(['DONE', 'PARTIAL', 'PENDING']);

    for (const cat of categories) {
      for (const feature of cat.features) {
        expect(feature.id).toBeTruthy();
        expect(feature.label).toBeTruthy();
        expect(feature.category).toBeTruthy();
        expect(validStatuses.has(feature.status)).toBe(true);
      }
    }
  });

  it('is deterministic — two consecutive calls return the same donePercent', () => {
    const first = getAppCompletion();
    const second = getAppCompletion();
    expect(first.donePercent).toBe(second.donePercent);
    expect(first.counts).toEqual(second.counts);
  });

  it('returns at least one category', () => {
    const { categories } = getAppCompletion();
    expect(categories.length).toBeGreaterThan(0);
  });

  it('all features in a category share that category name', () => {
    const { categories } = getAppCompletion();
    for (const cat of categories) {
      for (const feature of cat.features) {
        expect(feature.category).toBe(cat.name);
      }
    }
  });

  it('known categories are present in the manifest', () => {
    const { categories } = getAppCompletion();
    const names = categories.map((c) => c.name);

    expect(names).toContain('Autentisering');
    expect(names).toContain('Projekthantering');
    expect(names).toContain('Compliance & Revision');
    expect(names).toContain('AI & Kunskapsgraf');
  });

  it('implementationPercent is between donePercent and 100 when partial features exist', () => {
    const { donePercent, implementationPercent, counts } = getAppCompletion();
    if (counts.partial > 0) {
      expect(implementationPercent).toBeGreaterThanOrEqual(donePercent);
      expect(implementationPercent).toBeLessThanOrEqual(100);
    }
  });

  it('strict donePercent counts only DONE features', () => {
    const { counts, donePercent } = getAppCompletion();
    const expectedStrict = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    expect(donePercent).toBe(expectedStrict);
  });

  it('DONE-only manifest yields 100% for both metrics', () => {
    const { counts, donePercent, implementationPercent } = getAppCompletion();
    if (counts.pending === 0 && counts.partial === 0) {
      expect(donePercent).toBe(100);
      expect(implementationPercent).toBe(100);
    }
  });
});
