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

  it('falls back to deterministic synthetic terrain on live failures', async () => {
    process.env.TERRAIN_ENDPOINT = 'https://terrain.example.test/grid';
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('terrain offline'));

    const result = await getTerrainData([15.2, 60.1, 15.4, 60.3], 200);

    expect(result.source).toBe('synthetic');
    expect(result.resolution).toBe(128);
    expect(result.points).toHaveLength(128 * 128);
    expect(result.minElevation).toBeGreaterThanOrEqual(0);
    expect(result.maxElevation).toBeGreaterThan(result.minElevation);
    expect(mocks.loggerWarn).toHaveBeenCalledWith('terrain: live endpoint failed', {
      err: 'Error: terrain offline',
    });
  });
});
