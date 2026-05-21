import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LantmaterietAdapter } from '../../../src/infrastructure/lantmateriet-adapter';
import { tryFetchLocalPropertyGeometry } from '../../../server/services/hybridGeoService';

vi.mock('../../../server/services/hybridGeoService', () => ({
  tryFetchLocalPropertyGeometry: vi.fn(),
}));

describe('LantmaterietAdapter', () => {
  let adapter: LantmaterietAdapter;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PROPERTY_LOOKUP_MODE = 'postgis_first';
    vi.clearAllMocks();
    adapter = new LantmaterietAdapter();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns local PostGIS hit in postgis_first mode', async () => {
    vi.mocked(tryFetchLocalPropertyGeometry).mockResolvedValue({
      designation: 'NACKA BOO 1:1',
      boundaries: { properties: { kommunnamn: 'Nacka', area: 1234 } },
    } as any);

    const result = await adapter.fetchPropertyInfo('NACKA BOO 1:1');

    expect(tryFetchLocalPropertyGeometry).toHaveBeenCalledWith('NACKA BOO 1:1');
    expect(result?.designation).toBe('NACKA BOO 1:1');
    expect(result?.municipality).toBe('Nacka');
  });

  it('falls back to live API when local lookup is empty', async () => {
    vi.mocked(tryFetchLocalPropertyGeometry).mockResolvedValue(null);
    process.env.LANTMATERIET_PROPERTY_ENDPOINT = 'http://api.test/property';
    process.env.LANTMATERIET_CLIENT_ID = 'client';
    process.env.LANTMATERIET_CLIENT_SECRET = 'secret';
    process.env.LANTMATERIET_TOKEN_URL = 'http://api.test/token';

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'p1', designation: 'LIVE TEST 1:1', municipality: 'Teststad' }),
      } as any);

    const result = await adapter.fetchPropertyInfo('TEST 1:1');
    expect(global.fetch).toHaveBeenCalled();
    expect(result?.designation).toBe('LIVE TEST 1:1');
  });
});
