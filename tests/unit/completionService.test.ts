import { describe, expect, it } from 'vitest';

import { getAppCompletion } from '../../server/services/completionService';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('completionService – getAppCompletion', () => {
  // ── Return shape ───────────────────────────────────────────────────────────

  it('returns an AppCompletionResponse with all required fields', () => {
    const result = getAppCompletion();

    expect(result).toHaveProperty('checkedAt');
    expect(result).toHaveProperty('donePercent');
    expect(result).toHaveProperty('remainingPercent');
    expect(result).toHaveProperty('counts');
    expect(result).toHaveProperty('categories');
  });

  it('checkedAt is a valid ISO timestamp', () => {
    const result = getAppCompletion();
    expect(new Date(result.checkedAt).getTime()).not.toBeNaN();
  });

  // ── Percentage invariants ──────────────────────────────────────────────────

  it('donePercent + remainingPercent = 100', () => {
    const result = getAppCompletion();
    expect(result.donePercent + result.remainingPercent).toBe(100);
  });

  it('donePercent is between 0 and 100 inclusive', () => {
    const result = getAppCompletion();
    expect(result.donePercent).toBeGreaterThanOrEqual(0);
    expect(result.donePercent).toBeLessThanOrEqual(100);
  });

  // ── Count invariants ───────────────────────────────────────────────────────

  it('counts.total = counts.done + counts.partial + counts.pending', () => {
    const { counts } = getAppCompletion();
    expect(counts.total).toBe(counts.done + counts.partial + counts.pending);
  });

  it('counts.total is positive', () => {
    const { counts } = getAppCompletion();
    expect(counts.total).toBeGreaterThan(0);
  });

  it('counts.done is a non-negative integer', () => {
    const { counts } = getAppCompletion();
    expect(counts.done).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(counts.done)).toBe(true);
  });

  // ── Categories ────────────────────────────────────────────────────────────

  it('returns at least one category', () => {
    const result = getAppCompletion();
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it('each category has a name, total, and percent in 0–100', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      expect(typeof cat.name).toBe('string');
      expect(cat.name.length).toBeGreaterThan(0);
      expect(cat.total).toBeGreaterThan(0);
      expect(cat.percent).toBeGreaterThanOrEqual(0);
      expect(cat.percent).toBeLessThanOrEqual(100);
    }
  });

  it('sum of category totals equals overall total', () => {
    const result = getAppCompletion();
    const sumCat = result.categories.reduce((s, c) => s + c.total, 0);
    expect(sumCat).toBe(result.counts.total);
  });

  it('each category total = done + partial + pending', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      expect(cat.total).toBe(cat.done + cat.partial + cat.pending);
    }
  });

  it('each category has a features array matching its total', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      expect(Array.isArray(cat.features)).toBe(true);
      expect(cat.features.length).toBe(cat.total);
    }
  });

  // ── Feature manifest contents ──────────────────────────────────────────────

  it('all feature statuses are DONE, PARTIAL, or PENDING', () => {
    const result = getAppCompletion();
    const validStatuses = new Set(['DONE', 'PARTIAL', 'PENDING']);
    for (const cat of result.categories) {
      for (const f of cat.features) {
        expect(validStatuses.has(f.status)).toBe(true);
      }
    }
  });

  it('each feature has a non-empty id and label', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      for (const f of cat.features) {
        expect(typeof f.id).toBe('string');
        expect(f.id.length).toBeGreaterThan(0);
        expect(typeof f.label).toBe('string');
        expect(f.label.length).toBeGreaterThan(0);
      }
    }
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  it('returns consistent counts across multiple calls', () => {
    const r1 = getAppCompletion();
    const r2 = getAppCompletion();
    expect(r1.counts.total).toBe(r2.counts.total);
    expect(r1.counts.done).toBe(r2.counts.done);
    expect(r1.donePercent).toBe(r2.donePercent);
  });
});
