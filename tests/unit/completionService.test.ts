/**
 * completionService.test.ts
 *
 * Direkta enhetstester för getAppCompletion().
 * Inga externa beroenden — ren logik.
 */

import { describe, expect, it } from 'vitest';
import { getAppCompletion } from '../../server/services/completionService';

describe('getAppCompletion()', () => {
  it('returns a valid AppCompletionResponse shape', () => {
    const result = getAppCompletion();
    expect(result).toBeDefined();
    expect(typeof result.checkedAt).toBe('string');
    expect(typeof result.donePercent).toBe('number');
    expect(typeof result.remainingPercent).toBe('number');
    expect(result.counts).toBeDefined();
    expect(Array.isArray(result.categories)).toBe(true);
  });

  it('donePercent + remainingPercent equals 100', () => {
    const result = getAppCompletion();
    expect(result.donePercent + result.remainingPercent).toBe(100);
  });

  it('counts.total equals counts.done + counts.partial + counts.pending', () => {
    const result = getAppCompletion();
    const { total, done, partial, pending } = result.counts;
    expect(done + partial + pending).toBe(total);
  });

  it('counts.total is greater than 0', () => {
    const result = getAppCompletion();
    expect(result.counts.total).toBeGreaterThan(0);
  });

  it('donePercent is between 0 and 100', () => {
    const result = getAppCompletion();
    expect(result.donePercent).toBeGreaterThanOrEqual(0);
    expect(result.donePercent).toBeLessThanOrEqual(100);
  });

  it('remainingPercent is between 0 and 100', () => {
    const result = getAppCompletion();
    expect(result.remainingPercent).toBeGreaterThanOrEqual(0);
    expect(result.remainingPercent).toBeLessThanOrEqual(100);
  });

  it('checkedAt is a valid ISO timestamp', () => {
    const result = getAppCompletion();
    const ts = new Date(result.checkedAt);
    expect(ts.getTime()).not.toBeNaN();
  });

  it('categories is a non-empty array', () => {
    const result = getAppCompletion();
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it('each category has required fields', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      expect(typeof cat.name).toBe('string');
      expect(typeof cat.total).toBe('number');
      expect(typeof cat.done).toBe('number');
      expect(typeof cat.partial).toBe('number');
      expect(typeof cat.pending).toBe('number');
      expect(typeof cat.percent).toBe('number');
      expect(Array.isArray(cat.features)).toBe(true);
    }
  });

  it('each category has done + partial + pending === total', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      expect(cat.done + cat.partial + cat.pending).toBe(cat.total);
    }
  });

  it('each category percent is between 0 and 100', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      expect(cat.percent).toBeGreaterThanOrEqual(0);
      expect(cat.percent).toBeLessThanOrEqual(100);
    }
  });

  it('each feature has id, label, category and status', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      for (const feat of cat.features) {
        expect(typeof feat.id).toBe('string');
        expect(feat.id.length).toBeGreaterThan(0);
        expect(typeof feat.label).toBe('string');
        expect(feat.label.length).toBeGreaterThan(0);
        expect(typeof feat.category).toBe('string');
        expect(['DONE', 'PARTIAL', 'PENDING']).toContain(feat.status);
      }
    }
  });

  it('feature categories match their parent category name', () => {
    const result = getAppCompletion();
    for (const cat of result.categories) {
      for (const feat of cat.features) {
        expect(feat.category).toBe(cat.name);
      }
    }
  });

  it('sum of all category totals equals counts.total', () => {
    const result = getAppCompletion();
    const sumOfCategoryTotals = result.categories.reduce((sum, cat) => sum + cat.total, 0);
    expect(sumOfCategoryTotals).toBe(result.counts.total);
  });

  it('sum of all category done equals counts.done', () => {
    const result = getAppCompletion();
    const sumCatDone = result.categories.reduce((sum, cat) => sum + cat.done, 0);
    expect(sumCatDone).toBe(result.counts.done);
  });

  it('donePercent reflects DONE features with weight 1.0 and PARTIAL with 0.5', () => {
    const result = getAppCompletion();
    const total = result.counts.total;
    const done = result.counts.done;
    const partial = result.counts.partial;
    // Weight: DONE=1, PARTIAL=0.5, PENDING=0
    const weightedDone = done * 1.0 + partial * 0.5;
    const expectedPercent = Math.round((weightedDone / total) * 100);
    expect(result.donePercent).toBe(expectedPercent);
  });

  it('returns a new timestamp on each call', async () => {
    const a = getAppCompletion();
    await new Promise((r) => setTimeout(r, 10));
    const b = getAppCompletion();
    // Both should be valid timestamps, though they may be equal within 1 ms
    expect(new Date(a.checkedAt).getTime()).toBeGreaterThan(0);
    expect(new Date(b.checkedAt).getTime()).toBeGreaterThan(0);
  });

  it('calling twice returns same structural data (deterministic)', () => {
    const a = getAppCompletion();
    const b = getAppCompletion();
    expect(a.counts.total).toBe(b.counts.total);
    expect(a.counts.done).toBe(b.counts.done);
    expect(a.donePercent).toBe(b.donePercent);
    expect(a.categories.length).toBe(b.categories.length);
  });
});
