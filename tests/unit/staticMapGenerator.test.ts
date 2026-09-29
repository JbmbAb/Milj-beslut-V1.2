import { describe, expect, it, vi } from 'vitest';

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: queryRawMock },
}));

import { StaticMapGenerator } from '../../src/infrastructure/geo/static-map-generator';

const PROPERTY_ROW = [
  {
    designation: 'TEST 1:1',
    geojson: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
    }),
    min_x: 0,
    min_y: 0,
    max_x: 10,
    max_y: 10,
  },
];

function fakePdfDoc(): any {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn().mockReturnThis(),
    fillColor: vi.fn().mockReturnThis(),
    strokeColor: vi.fn().mockReturnThis(),
    lineWidth: vi.fn().mockReturnThis(),
    fillAndStroke: vi.fn().mockReturnThis(),
    fillOpacity: vi.fn().mockReturnThis(),
    strokeOpacity: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    path: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    fontSize: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
  };
}

describe('StaticMapGenerator -- unavailable-layer tracking (W3c)', () => {
  describe('generateMap', () => {
    it('marks Natura 2000 as unavailable when its query throws, instead of silently reporting zero zones', async () => {
      queryRawMock
        .mockResolvedValueOnce(PROPERTY_ROW) // 1. property
        .mockResolvedValueOnce([]) // 2. buildings
        .mockRejectedValueOnce(new Error('timeout')) // 3. natura2000 -- FAILS
        .mockResolvedValueOnce([]) // 4. protected_area
        .mockResolvedValueOnce([]); // 5. water_protection

      const generator = new StaticMapGenerator();
      const result = await generator.generateMap('TEST 1:1');

      expect(result.intersectingZones).toEqual([]);
      expect(Array.isArray(result.unavailableLayers)).toBe(true);
      expect(result.unavailableLayers).toContain('Natura 2000');
      expect(result.unavailableLayers).not.toContain('Skyddat område');
      expect(result.unavailableLayers).not.toContain('Vattenskyddsområde');
    });

    it('M3/S1 baseline -- reports no unavailable layers when every protection-zone query succeeds', async () => {
      queryRawMock
        .mockResolvedValueOnce(PROPERTY_ROW)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const generator = new StaticMapGenerator();
      const result = await generator.generateMap('TEST 1:1');

      expect(result.unavailableLayers).toEqual([]);
      expect(result.intersectingZones).toEqual([]);
    });

    it('S2 -- propagates the property-lookup failure as a real error, never as "no zones found"', async () => {
      queryRawMock.mockResolvedValueOnce([]); // property lookup returns nothing

      const generator = new StaticMapGenerator();

      await expect(generator.generateMap('MISSING 1:1')).rejects.toThrow(/Kunde inte hitta fastighet/);
    });
  });

  describe('drawMapToPdf (the path sewagePdfService actually calls)', () => {
    it('S1 -- marks Natura 2000 as unavailable when its query throws', async () => {
      queryRawMock
        .mockResolvedValueOnce(PROPERTY_ROW)
        .mockResolvedValueOnce([]) // buildings
        .mockRejectedValueOnce(new Error('timeout')) // natura2000 FAILS
        .mockResolvedValueOnce([]) // protected_area
        .mockResolvedValueOnce([]); // water_protection

      const generator = new StaticMapGenerator();
      const result = await generator.drawMapToPdf(fakePdfDoc(), 'TEST 1:1', 0, 0, 450, 250, 25);

      expect(result.intersectingZones).toEqual([]);
      expect(result.unavailableLayers).toContain('Natura 2000');
    });

    it('S1 -- marks Skyddat omrade as unavailable when its query throws', async () => {
      queryRawMock
        .mockResolvedValueOnce(PROPERTY_ROW)
        .mockResolvedValueOnce([]) // buildings
        .mockResolvedValueOnce([]) // natura2000
        .mockRejectedValueOnce(new Error('connection reset')) // protected_area FAILS
        .mockResolvedValueOnce([]); // water_protection

      const generator = new StaticMapGenerator();
      const result = await generator.drawMapToPdf(fakePdfDoc(), 'TEST 1:1', 0, 0, 450, 250, 25);

      expect(result.unavailableLayers).toContain('Skyddat område');
    });

    it('marks Vattenskyddsomrade as unavailable when its query throws', async () => {
      queryRawMock
        .mockResolvedValueOnce(PROPERTY_ROW)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('connection reset')); // water_protection FAILS

      const generator = new StaticMapGenerator();
      const result = await generator.drawMapToPdf(fakePdfDoc(), 'TEST 1:1', 0, 0, 450, 250, 25);

      expect(result.unavailableLayers).toContain('Vattenskyddsområde');
    });

    it('S1 baseline -- reports no unavailable layers when every protection-zone query succeeds', async () => {
      queryRawMock
        .mockResolvedValueOnce(PROPERTY_ROW)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const generator = new StaticMapGenerator();
      const result = await generator.drawMapToPdf(fakePdfDoc(), 'TEST 1:1', 0, 0, 450, 250, 25);

      expect(result.unavailableLayers).toEqual([]);
    });

    it('S2 -- propagates the property-lookup failure as a real error, never as "no zones found"', async () => {
      queryRawMock.mockResolvedValueOnce([]);

      const generator = new StaticMapGenerator();

      await expect(
        generator.drawMapToPdf(fakePdfDoc(), 'MISSING 1:1', 0, 0, 450, 250, 25),
      ).rejects.toThrow(/Kunde inte hitta fastighet/);
    });
  });
});
