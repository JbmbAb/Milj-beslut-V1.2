import { describe, it, expect } from 'vitest';
import { getAppCompletion } from '../../server/services/completionService';

describe('completionService unit tests', () => {

  it('should return a valid completion status object', () => {
    const status = getAppCompletion();

    expect(status).toBeDefined();
    expect(status.donePercent).toBeGreaterThan(0);
    expect(status.remainingPercent).toBeLessThan(100);
    expect(status.counts.total).toBeGreaterThan(0);
    expect(Array.isArray(status.categories)).toBe(true);
  });

  it('should have consistent percentages that add up to 100', () => {
    const status = getAppCompletion();
    expect(status.donePercent + status.remainingPercent).toBe(100);
  });

  it('should include specific categories from the manifest', () => {
    const status = getAppCompletion();
    const categoryNames = status.categories.map(c => c.name);

    expect(categoryNames).toContain('Autentisering');
    expect(categoryNames).toContain('Geodata & Kartfunktioner');
    expect(categoryNames).toContain('Administration & Drift');
  });

  it('should correctly weight statuses (DONE=1.0, PARTIAL=0.5)', () => {
    const status = getAppCompletion();
    
    // Vi verifierar den interna logiken indirekt genom att kika på en kategori
    const authCat = status.categories.find(c => c.name === 'Autentisering');
    if (authCat) {
        // Om alla i auth är DONE ska procenten vara 100
        const expectedPercent = Math.round(((authCat.done + authCat.partial * 0.5) / authCat.total) * 100);
        expect(authCat.percent).toBe(expectedPercent);
    }
  });

  it('should return a checkedAt timestamp in ISO format', () => {
    const status = getAppCompletion();
    expect(new Date(status.checkedAt).getTime()).not.toBeNaN();
  });

});
