import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

import { fetchAncientMonuments } from '../../server/services/raaService';

describe('raaService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps multiple geometry types into nearby monument results', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            id: 'point-1',
            geometry: {
              type: 'Point',
              coordinates: [15.21, 60.15],
            },
            properties: {
              namn: 'Runsten',
              antikvarisk_bedomning: 'Fornlamning',
            },
          },
          {
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [15.22, 60.16],
                  [15.23, 60.16],
                  [15.23, 60.17],
                  [15.22, 60.16],
                ],
              ],
            },
            properties: {
              lamningsnummer: 'poly-2',
              lamningstyp: 'Gravfalt',
            },
          },
          {
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [15.24, 60.18],
                  [15.25, 60.19],
                ],
              ],
            },
            properties: {
              raa_nummer: 'line-3',
            },
          },
          {
            geometry: {
              type: 'GeometryCollection',
              coordinates: [],
            },
            properties: {
              namn: 'ignored',
            },
          },
        ],
      }),
    } as Response);

    const result = await fetchAncientMonuments(60.14, 15.2);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'point-1',
        name: 'Runsten',
        type: 'Fornlamning',
      }),
      expect.objectContaining({
        id: 'poly-2',
        name: 'Gravfalt',
        type: 'Gravfalt',
      }),
      expect.objectContaining({
        id: 'line-3',
        name: 'Fornlamning',
        type: 'Kulturarv',
      }),
    ]);
    expect(result.every((item) => item.distance >= 0)).toBe(true);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://pub.raa.se/visning/lamningar_v1/wfs?service=WFS&version=2.0.0&request=GetFeature',
      ),
    );
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('urn:ogc:def:crs:EPSG::4326'),
    );
  });

  it('returns an empty list on non-ok responses', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
    } as Response);

    await expect(fetchAncientMonuments(60.14, 15.2)).resolves.toEqual([]);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('logs and swallows fetch errors', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('raa offline'));

    await expect(fetchAncientMonuments(60.14, 15.2)).resolves.toEqual([]);
    expect(mocks.loggerError).toHaveBeenCalledWith('RAA fetch failed', {
      err: 'Error: raa offline',
    });
  });
});
