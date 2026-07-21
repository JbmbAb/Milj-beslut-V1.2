import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  isWithinRadiusKm,
  isWithinBoundingBox,
  addCoordinateJitter,
} from '../../server/utils/geoUtils';

describe('geoUtils', () => {
  describe('haversineKm', () => {
    it('beräknar avstånd Stockholm → Göteborg (~416 km)', () => {
      const dist = haversineKm(59.334, 18.063, 57.708, 11.974);
      // Haversine great-circle for these exact coordinates is ~397 km.
      expect(dist).toBeGreaterThan(380);
      expect(dist).toBeLessThan(430);
    });

    it('returnerar 0 för samma punkt', () => {
      expect(haversineKm(59.0, 18.0, 59.0, 18.0)).toBe(0);
    });

    it('är symmetrisk (A→B = B→A)', () => {
      const d1 = haversineKm(59.0, 18.0, 55.0, 13.0);
      const d2 = haversineKm(55.0, 13.0, 59.0, 18.0);
      expect(d1).toBeCloseTo(d2, 6);
    });

    it('beräknar kort avstånd korrekt (~1 km)', () => {
      // 0.009 grader latitud ≈ 1 km
      const dist = haversineKm(59.0, 18.0, 59.009, 18.0);
      expect(dist).toBeGreaterThan(0.9);
      expect(dist).toBeLessThan(1.1);
    });

    it('hanterar negativa koordinater (södra halvklotet)', () => {
      const dist = haversineKm(-33.87, 151.21, -37.81, 144.96); // Sydney → Melbourne ≈ 714 km
      expect(dist).toBeGreaterThan(700);
      expect(dist).toBeLessThan(730);
    });
  });

  describe('isWithinRadiusKm', () => {
    it('returnerar true när punkt är inom radien', () => {
      expect(isWithinRadiusKm(59.334, 18.063, 59.335, 18.064, 1)).toBe(true);
    });

    it('returnerar false när punkt är utanför radien', () => {
      expect(isWithinRadiusKm(59.334, 18.063, 57.708, 11.974, 100)).toBe(false);
    });

    it('returnerar true vid exakt gränsen (punkt på radien)', () => {
      const dist = haversineKm(59.0, 18.0, 59.009, 18.0);
      expect(isWithinRadiusKm(59.0, 18.0, 59.009, 18.0, dist)).toBe(true);
    });
  });

  describe('isWithinBoundingBox', () => {
    it('returnerar true när punkt är inom bbox', () => {
      expect(isWithinBoundingBox(59.0, 18.0, 55.0, 15.0, 68.0, 25.0)).toBe(true);
    });

    it('returnerar false när lat är under minLat', () => {
      expect(isWithinBoundingBox(54.0, 18.0, 55.0, 15.0, 68.0, 25.0)).toBe(false);
    });

    it('returnerar false när lat är över maxLat', () => {
      expect(isWithinBoundingBox(69.0, 18.0, 55.0, 15.0, 68.0, 25.0)).toBe(false);
    });

    it('returnerar false när lng är under minLng', () => {
      expect(isWithinBoundingBox(59.0, 14.0, 55.0, 15.0, 68.0, 25.0)).toBe(false);
    });

    it('returnerar false när lng är över maxLng', () => {
      expect(isWithinBoundingBox(59.0, 26.0, 55.0, 15.0, 68.0, 25.0)).toBe(false);
    });

    it('returnerar true på exakt gränsen', () => {
      expect(isWithinBoundingBox(55.0, 15.0, 55.0, 15.0, 68.0, 25.0)).toBe(true);
    });
  });

  describe('addCoordinateJitter', () => {
    it('returnerar objekt med lat och lng', () => {
      const result = addCoordinateJitter(59.0, 18.0);
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lng');
    });

    it('ändrar koordinaten med ett litet belopp', () => {
      const result = addCoordinateJitter(59.0, 18.0, 0.02);
      expect(Math.abs(result.lat - 59.0)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(result.lng - 18.0)).toBeLessThanOrEqual(0.02);
    });

    it('respekterar magnitude-parametern', () => {
      // Kör 20 gånger för statistisk säkerhet
      for (let i = 0; i < 20; i++) {
        const r = addCoordinateJitter(0, 0, 0.001);
        expect(Math.abs(r.lat)).toBeLessThanOrEqual(0.001);
        expect(Math.abs(r.lng)).toBeLessThanOrEqual(0.001);
      }
    });

    it('använder 0.02 som standard-magnitude', () => {
      const result = addCoordinateJitter(59.0, 18.0);
      expect(Math.abs(result.lat - 59.0)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(result.lng - 18.0)).toBeLessThanOrEqual(0.02);
    });
  });
});
