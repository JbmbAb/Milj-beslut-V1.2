import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: prismaMocks.queryRaw,
    $queryRawUnsafe: prismaMocks.queryRawUnsafe,
  },
}));

import { getDatasetMapLayer } from '../../server/services/postgisLayerService';

const BBOX = { minLng: 17.6, minLat: 59.85, maxLng: 17.7, maxLat: 59.9 };

describe('postgisLayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unavailable meta for unknown layer key', async () => {
    const layer = await getDatasetMapLayer('not_a_real_layer_key', BBOX);

    expect(layer.features).toEqual([]);
    expect(layer.meta?.available).toBe(false);
    expect(layer.meta?.warning).toContain('Okänt dataset-lager');
    expect(prismaMocks.queryRaw).not.toHaveBeenCalled();
  });

  it('returns unavailable meta when PostGIS table is missing', async () => {
    prismaMocks.queryRaw.mockResolvedValue([{ regclass: null }]);

    const layer = await getDatasetMapLayer('sgu_wells', BBOX);

    expect(layer.features).toEqual([]);
    expect(layer.meta?.available).toBe(false);
    expect(layer.meta?.warning).toContain('saknas i PostGIS');
    expect(layer.meta?.layerKey).toBe('sgu_wells');
  });

  it('returns unavailable meta when query fails', async () => {
    prismaMocks.queryRaw.mockResolvedValue([{ regclass: 'env.sgu_wells' }]);
    prismaMocks.queryRawUnsafe.mockRejectedValue(new Error('relation denied'));

    const layer = await getDatasetMapLayer('sgu_wells', BBOX);

    expect(layer.features).toEqual([]);
    expect(layer.meta?.available).toBe(false);
    expect(layer.meta?.warning).toContain('Kunde inte läsa');
  });

  it('skips rows with invalid geojson and returns valid features', async () => {
    prismaMocks.queryRaw.mockResolvedValue([{ regclass: 'env.sgu_wells' }]);
    prismaMocks.queryRawUnsafe.mockResolvedValue([
      {
        geojson: 'not-json',
        geometry_type: 'ST_Point',
        raw_properties: { id: 1 },
      },
      {
        geojson: JSON.stringify({ type: 'Point', coordinates: [18.0, 59.3] }),
        geometry_type: 'ST_Point',
        raw_properties: { id: 2, name: 'Brunn A' },
      },
    ]);

    const layer = await getDatasetMapLayer('sgu_wells', BBOX, 100);

    expect(layer.meta?.available).toBe(true);
    expect(layer.meta?.source).toBe('local_postgis');
    expect(layer.features).toHaveLength(1);
    expect(layer.features[0]?.properties).toMatchObject({
      id: 2,
      name: 'Brunn A',
      layerKey: 'sgu_wells',
      source: 'SGU',
    });
  });

  it('clamps row limit between 1 and 3000', async () => {
    prismaMocks.queryRaw.mockResolvedValue([{ regclass: 'env.sgu_wells' }]);
    prismaMocks.queryRawUnsafe.mockResolvedValue([]);

    await getDatasetMapLayer('sgu_wells', BBOX, 99999);
    expect(prismaMocks.queryRawUnsafe.mock.calls[0]?.[5]).toBe(3000);

    await getDatasetMapLayer('sgu_wells', BBOX, 0);
    expect(prismaMocks.queryRawUnsafe.mock.calls[1]?.[5]).toBe(1);
  });
});
