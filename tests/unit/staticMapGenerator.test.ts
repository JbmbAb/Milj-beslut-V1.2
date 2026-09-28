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

describe('StaticMapGenerator -- unavailable-layer tracking (W3c)', () => {
  it('W3c: marks Natura 2000 as unavailable when its query throws, instead of silently reporting zero zones', async () => {
    queryRawMock
      .mockResolvedValueOnce(PROPERTY_ROW) // 1. property
      .mockResolvedValueOnce([]) // 2. buildings
      .mockRejectedValueOnce(new Error('timeout')) // 3. natura2000 -- FAILS
      .mockResolvedValueOnce([]) // 4. protected_area
      .mockResolvedValueOnce([]); // 5. water_protection

    const generator = new StaticMapGenerator();
    const result = await generator.generateMap('TEST 1:1');

    expect(result.intersectingZones).toEqual([]);
    expect(result.unavailableLayers).toContain('Natura 2000');
    expect(result.unavailableLayers).not.toContain('Skyddat område');
    expect(result.unavailableLayers).not.toContain('Vattenskyddsområde');
  });

  it('W3c: reports no unavailable layers when every protection-zone query succeeds', async () => {
    queryRawMock
      .mockResolvedValueOnce(PROPERTY_ROW)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const generator = new StaticMapGenerator();
    const result = await generator.generateMap('TEST 1:1');

    expect(result.unavailableLayers).toEqual([]);
  });

  it('W3c: drawMapToPdf (the PDF-drawing path) also reports unavailable layers, not just generateMap', async () => {
    queryRawMock
      .mockResolvedValueOnce(PROPERTY_ROW)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('connection reset')); // water_protection FAILS

    const fakeDoc: any = {
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

    const generator = new StaticMapGenerator();
    const result = await generator.drawMapToPdf(fakeDoc, 'TEST 1:1', 0, 0, 450, 250, 25);

    expect(result.intersectingZones).toEqual([]);
    expect(result.unavailableLayers).toContain('Vattenskyddsområde');
  });
});
