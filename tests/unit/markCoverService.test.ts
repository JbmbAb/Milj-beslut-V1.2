import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: mocks.loggerWarn,
  },
}));

import { getMarkCoverLayer } from '../../server/services/markCoverService';

describe('markCoverService', () => {
  const originalFetch = global.fetch;
  const originalEndpoint = process.env.LULC_ENDPOINT;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    delete process.env.LULC_ENDPOINT;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.LULC_ENDPOINT;
    else process.env.LULC_ENDPOINT = originalEndpoint;
  });

  it('returns PostGIS-backed mark cover hits when raster values exist', async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([
      {
        nmd_code: 11,
        center_x: 15.25,
        center_y: 60.15,
      },
      {
        nmd_code: 99,
        center_x: 15.3,
        center_y: 60.2,
      },
    ]);

    const result = await getMarkCoverLayer([15.2, 60.1, 15.4, 60.3]);

    expect(result).toMatchObject({
      type: 'FeatureCollection',
      source: 'postgis',
      bbox: [15.2, 60.1, 15.4, 60.3],
    });
    expect(result.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [15.25, 60.15] },
        properties: { nmdCode: 11, description: 'Skog' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [15.3, 60.2] },
        properties: { nmdCode: 99, description: 'Okänd kod (99)' },
      },
    ]);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('falls back to external WFS data when local raster data is unavailable', async () => {
    process.env.LULC_ENDPOINT = 'https://lulc.example.test/wfs';
    mocks.queryRawUnsafe.mockRejectedValueOnce(new Error('relation env.marktacke does not exist'));
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [] },
            properties: {
              nmdCode: 21,
              description: 'Jordbruksmark',
            },
          },
        ],
      }),
    } as Response);

    const result = await getMarkCoverLayer([15.2, 60.1, 15.4, 60.3]);

    expect(result).toMatchObject({
      source: 'wms',
      features: [
        expect.objectContaining({
          properties: expect.objectContaining({
            description: 'Jordbruksmark',
          }),
        }),
      ],
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('service=WFS'),
      expect.any(Object),
    );
  });

  it('logs endpoint failures and returns empty collection when no mark cover source succeeds', async () => {
    process.env.LULC_ENDPOINT = 'https://lulc.example.test/wfs';
    mocks.queryRawUnsafe.mockResolvedValueOnce([]);
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('wfs offline'));

    const result = await getMarkCoverLayer([15.2, 60.1, 15.4, 60.3]);

    expect(result).toMatchObject({
      type: 'FeatureCollection',
      source: 'postgis',
      features: [],
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith('markcover: WMS fetch failed', {
      err: 'Error: wfs offline',
    });
  });

  it('returns empty collection when PostGIS is empty and no LULC_ENDPOINT is configured', async () => {
    // No LULC_ENDPOINT set (deleted in beforeEach)
    mocks.queryRawUnsafe.mockResolvedValueOnce([]);

    const result = await getMarkCoverLayer([15.2, 60.1, 15.4, 60.3]);

    expect(result).toMatchObject({
      type: 'FeatureCollection',
      source: 'postgis',
      features: [],
    });
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('filters out null nmd_code rows from PostGIS results', async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([
      { nmd_code: 11, center_x: 15.25, center_y: 60.15 },
      { nmd_code: null, center_x: 15.3, center_y: 60.2 },
    ]);

    const result = await getMarkCoverLayer([15.2, 60.1, 15.4, 60.3]);

    // Only non-null rows should appear
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.nmdCode).toBe(11);
  });

  it('falls through to empty collection when WFS responds with ok:false', async () => {
    process.env.LULC_ENDPOINT = 'https://lulc.example.test/wfs';
    mocks.queryRawUnsafe.mockResolvedValueOnce([]);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const result = await getMarkCoverLayer([15.2, 60.1, 15.4, 60.3]);
    expect(result.features).toEqual([]);
    expect(result.source).toBe('postgis');
  });
});
