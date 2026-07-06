import { describe, expect, it } from 'vitest';
import { distanceMetersBetweenSites } from '../../server/modules/localization/distanceCalculator';

describe('distanceMetersBetweenSites', () => {
  it('returns zero for identical coordinates', () => {
    const point = { lat: 59.33, lng: 18.07 };
    expect(distanceMetersBetweenSites(point, point)).toBe(0);
  });

  it('computes a plausible distance between Stockholm and Uppsala', () => {
    const stockholm = { lat: 59.3293, lng: 18.0686 };
    const uppsala = { lat: 59.8586, lng: 17.6389 };
    const meters = distanceMetersBetweenSites(stockholm, uppsala);

    expect(meters).toBeGreaterThan(50_000);
    expect(meters).toBeLessThan(80_000);
  });

  it('is symmetric regardless of argument order', () => {
    const a = { lat: 59.33, lng: 18.07 };
    const b = { lat: 59.35, lng: 18.1 };
    expect(distanceMetersBetweenSites(a, b)).toBeCloseTo(distanceMetersBetweenSites(b, a), 6);
  });
});
