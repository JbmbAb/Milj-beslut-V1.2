import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: mocks.loggerWarn,
  },
}));

import { getTerrainData } from '../../server/services/terrainService';

describe('terrainService', () => {
  const originalFetch = global.fetch;
  const originalEndpoint = process.env.TERRAIN_ENDPOINT;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    delete process.env.TERRAIN_ENDPOINT;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.TERRAIN_ENDPOINT;
    else process.env.TERRAIN_ENDPOINT = originalEndpoint;
  });

  it('returns live terrain data when the configured endpoint responds with points', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        points: [
          { lat: 60.1, lng: 15.2, elevationM: 42 },
          { lat: 60.2, lng: 15.3, elevationM: 67 },
        ],
      }),
    } as Response);

    const result = await getTerrainData([15.2, 60.1, 15.4, 60.3], 2);

    expect(result).toMatchObject({
      bbox: [15.2, 60.1, 15.4, 60.3],
      resolution: 4,
      source: 'live',
      minElevation: 42,
      maxElevation: 67,
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('bbox=15.2%2C60.1%2C15.4%2C60.3'),
      expect.any(Object),
    );
  });

  it('throws when the live endpoint fails', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('terrain offline'));

    await expect(getTerrainData([15.2, 60.1, 15.4, 60.3], 200)).rejects.toThrow(
      'Terrängdata kunde inte hämtas från livekälla.',
    );

    expect(mocks.loggerWarn).toHaveBeenCalledWith('terrain: live endpoint failed', {
      err: 'Error: terrain offline',
    });
  });

  it('throws when no TERRAIN_ENDPOINT is configured', async () => {
    await expect(getTerrainData([15.2, 60.1, 15.4, 60.3], 32)).rejects.toThrow('TERRAIN_ENDPOINT saknas');

    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });

  it('throws when the live endpoint returns ok:false', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    await expect(getTerrainData([15.2, 60.1, 15.4, 60.3], 32)).rejects.toThrow(
      'Terrängdata kunde inte hämtas från livekälla.',
    );

    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('throws when live endpoint returns empty points array', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [] }),
    } as Response);

    await expect(getTerrainData([15.2, 60.1, 15.4, 60.3], 8)).rejects.toThrow(
      'Terrängdata kunde inte hämtas från livekälla.',
    );
  });

  it('clamps resolution to minimum 4 when value below minimum is supplied', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [{ lat: 60.1, lng: 15.2, elevationM: 42 }] }),
    } as Response);

    const result = await getTerrainData([15.2, 60.1, 15.4, 60.3], 1);

    expect(result.resolution).toBe(4);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('resolution=4'),
      expect.any(Object),
    );
  });

  it('includes fetchedAt ISO timestamp in the returned grid', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [{ lat: 60.1, lng: 15.2, elevationM: 42 }] }),
    } as Response);

    const result = await getTerrainData([15.2, 60.1, 15.4, 60.3], 4);

    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
