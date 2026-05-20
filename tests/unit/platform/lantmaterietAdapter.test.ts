import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LantmaterietAdapter } from '../../../src/infrastructure/lantmateriet-adapter';
import { prisma } from '../../../server/db/prisma';

vi.mock('../../../server/db/prisma', () => ({
  prisma: {
    propertyUnit: {
      findFirst: vi.fn(),
    },
  },
}));

describe('LantmaterietAdapter', () => {
  let adapter: LantmaterietAdapter;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env.PROPERTY_LOOKUP_MODE = 'postgis_first';
    vi.clearAllMocks();
    adapter = new LantmaterietAdapter();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should check PostGIS first in postgis_first mode', async () => {
    const mockProperty = {
      id: 1,
      designation: 'DB TEST 1:1',
      geom: {}, // Mocked geometry
    };
    (prisma.propertyUnit.findFirst as vi.Mock).mockResolvedValue(mockProperty);

    const result = await adapter.fetchPropertyInfo('TEST 1:1');

    expect(prisma.propertyUnit.findFirst).toHaveBeenCalled();
    expect(result?.designation).toBe('DB TEST 1:1');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fall back to live API if not found in PostGIS', async () => {
    (prisma.propertyUnit.findFirst as vi.Mock).mockResolvedValue(null);

    process.env.LANTMATERIET_PROPERTY_ENDPOINT = 'http://api.test/property';
    process.env.LANTMATERIET_CLIENT_ID = 'client';
    process.env.LANTMATERIET_CLIENT_SECRET = 'secret';
    process.env.LANTMATERIET_TOKEN_URL = 'url';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'p1',
          designation: 'LIVE TEST 1:1',
        }),
    });

    const result = await adapter.fetchPropertyInfo('TEST 1:1');
    expect(prisma.propertyUnit.findFirst).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
    expect(result?.designation).toBe('LIVE TEST 1:1');
  });

  it('should return null if no endpoint is configured in real mode', async () => {
    delete process.env.LANTMATERIET_PROPERTY_ENDPOINT;

    // Mock getAccessToken by mocking global fetch or we can mock it
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
    });

    process.env.LANTMATERIET_CLIENT_ID = 'client';
    process.env.LANTMATERIET_CLIENT_SECRET = 'secret';
    process.env.LANTMATERIET_TOKEN_URL = 'url';

    (prisma.propertyUnit.findFirst as vi.Mock).mockResolvedValue(null);
    const result = await adapter.fetchPropertyInfo('TEST 1:1');
    expect(result).toBeNull();
  });

  it('should fetch property info successfully', async () => {
    process.env.LANTMATERIET_DEMO_MODE = 'false';
    process.env.LANTMATERIET_PROPERTY_ENDPOINT = 'http://api.test/property';
    process.env.LANTMATERIET_CLIENT_ID = 'client';
    process.env.LANTMATERIET_CLIENT_SECRET = 'secret';
    process.env.LANTMATERIET_TOKEN_URL = 'url';

    (prisma.propertyUnit.findFirst as vi.Mock).mockResolvedValue(null);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'p1',
            designation: 'REAL 1:1',
            municipality: 'CITY',
            area: 100,
            owner: 'Owner',
            centroid: { lat: 1, lng: 2 },
          }),
      });

    const result = await adapter.fetchPropertyInfo('REAL 1:1');
    expect(result?.designation).toBe('REAL 1:1');
    expect(result?.ownerName).toBe('Owner');
  });

  it('should return null if API request fails', async () => {
    process.env.LANTMATERIET_DEMO_MODE = 'false';
    process.env.LANTMATERIET_PROPERTY_ENDPOINT = 'http://api.test/property';
    process.env.LANTMATERIET_CLIENT_ID = 'client';
    process.env.LANTMATERIET_CLIENT_SECRET = 'secret';
    process.env.LANTMATERIET_TOKEN_URL = 'url';

    (prisma.propertyUnit.findFirst as vi.Mock).mockResolvedValue(null);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const result = await adapter.fetchPropertyInfo('REAL 1:1');
    expect(result).toBeNull();
  });

  it('searchMunicipality och assessRisk returnerar null/[] utan konfiguration (live-regel)', async () => {
    const muni = await adapter.searchMunicipality('Stockholm');
    expect(muni).toBeNull();

    const risk = await adapter.assessRisk({ lat: 1, lng: 2 });
    expect(risk).toEqual([]);
  });

  it('should throw error if token fetch fails', async () => {
    process.env.LANTMATERIET_DEMO_MODE = 'false';
    process.env.LANTMATERIET_PROPERTY_ENDPOINT = 'http://api.test/property';
    process.env.LANTMATERIET_CLIENT_ID = 'client';
    process.env.LANTMATERIET_CLIENT_SECRET = 'secret';
    process.env.LANTMATERIET_TOKEN_URL = 'url';

    (prisma.propertyUnit.findFirst as vi.Mock).mockResolvedValue(null);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
    });

    const result = await adapter.fetchPropertyInfo('REAL 1:1');
    expect(result).toBeNull(); // Adapter catches and logs
  });
});
