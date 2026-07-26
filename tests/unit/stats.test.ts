import { describe, expect, it } from 'vitest';
import { computeStats } from '../../server/lib/stats';

describe('computeStats', () => {
  it('returns zeros for empty input', () => {
    expect(computeStats([])).toEqual({ avg: 0, count: 0, variance: 0 });
  });

  it('computes population variance for semantic distances', () => {
    const stats = computeStats([0.1, 0.3, 0.5]);
    expect(stats.avg).toBe(0.3);
    expect(stats.count).toBe(3);
    // ((0.1-0.3)^2 + (0.3-0.3)^2 + (0.5-0.3)^2) / 3 = 0.08 / 3 ≈ 0.0267
    expect(stats.variance).toBeCloseTo(0.0267, 4);
  });
});
