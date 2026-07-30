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
    process.env.PROPERTY_LOOKUP_MODE = 'postgis';
    vi.clearAllMocks();
    adapter = new LantmaterietAdapter();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns local PostGIS hit', async () => {
    vi.mocked(tryFetchLocalPropertyGeometry).mockResolvedValue({
      designation: 'NACKA BOO 1:1',
      boundaries: { properties: { kommunnamn: 'Nacka', area: 1234 } },
    } as any);

    const result = await adapter.fetchPropertyInfo('NACKA BOO 1:1');

    expect(tryFetchLocalPropertyGeometry).toHaveBeenCalledWith('NACKA BOO 1:1');
    expect(result?.designation).toBe('NACKA BOO 1:1');
    expect(result?.municipality).toBe('Nacka');
  });

  it('returns null without network when PostGIS miss', async () => {
    vi.mocked(tryFetchLocalPropertyGeometry).mockResolvedValue(null);
    global.fetch = vi.fn();

    const result = await adapter.fetchPropertyInfo('TEST 1:1');
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not call live API even when mode=live (disabled)', async () => {
    process.env.PROPERTY_LOOKUP_MODE = 'live';
    process.env.LANTMATERIET_PROPERTY_ENDPOINT = 'http://api.test/property';
    global.fetch = vi.fn();

    const result = await adapter.fetchPropertyInfo('TEST 1:1');
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(tryFetchLocalPropertyGeometry).not.toHaveBeenCalled();
  });
});
