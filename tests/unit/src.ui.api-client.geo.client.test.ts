import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfTokenCache } from '../../services/csrfClient';
import {
  fetchDynamicLayer,
  fetchMapLayerCatalog,
  fetchPropertyInfo,
  fetchSpatialAudit,
  mapLookupResultToPropertyInfo,
} from '../../src/ui/api-client/geo.client';

describe('src/ui/api-client/geo.client', () => {
  afterEach(() => {
    resetCsrfTokenCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns property info result on success', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { designation: 'X', municipality: 'Y' },
        }),
      }) as unknown as typeof fetch;

    await expect(fetchPropertyInfo('1:23', 'project-1')).resolves.toEqual({
      id: 'X',
      designation: 'X',
      municipality: 'Y',
      areaM2: undefined,
      centroid: undefined,
    });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/csrf-token', {
      method: 'GET',
      credentials: 'same-origin',
    });

    const [url, init] = vi.mocked(global.fetch).mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/property/lookup');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        propertyDesignation: '1:23',
        projectId: 'project-1',
        purpose: 'GEO_CLIENT',
      }),
    );
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-123');
  });

  it('throws API error messages for property lookup and dynamic layers', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'lookup failed' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'layer failed' }),
      }) as unknown as typeof fetch;

    await expect(fetchPropertyInfo('1:23')).rejects.toThrow('lookup failed');
    await expect(fetchDynamicLayer('/api/layer', '1,2,3,4')).rejects.toThrow('layer failed');
  });

  it('handles spatial audit and dynamic layer success', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Audit ready' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'FeatureCollection', features: [] }),
      }) as unknown as typeof fetch;

    await expect(fetchSpatialAudit(59.33, 18.06)).resolves.toBe('Audit ready');
    await expect(fetchDynamicLayer('/api/layer', '10,11,12,13')).resolves.toEqual({
      type: 'FeatureCollection',
      features: [],
    });

    const [, spatialAuditInit] = vi.mocked(global.fetch).mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(spatialAuditInit.headers).get('x-csrf-token')).toBe('csrf-123');
    expect(global.fetch).toHaveBeenNthCalledWith(3, '/api/layer?bbox=10%2C11%2C12%2C13');
  });

  it('loads the map layer catalog and validates the response shape', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        layers: [{ key: 'postgis_nvr', label: 'Skyddad natur', endpoint: '/api/layers/nvr' }],
      }),
    }) as unknown as typeof fetch;

    await expect(fetchMapLayerCatalog()).resolves.toEqual([
      { key: 'postgis_nvr', label: 'Skyddad natur', endpoint: '/api/layers/nvr' },
    ]);

    expect(global.fetch).toHaveBeenCalledWith('/api/reference/map-layers', { credentials: 'same-origin' });
  });

  it('derives centroid from polygon geometry in lookup payloads', () => {
    expect(
      mapLookupResultToPropertyInfo({
        designation: 'ORSA STACKMORA 3:12>1',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [14.66, 61.13],
              [14.67, 61.13],
              [14.67, 61.14],
              [14.66, 61.13],
            ],
          ],
        },
        boundaries: {
          properties: { municipalityName: 'Orsa', area: 5962 },
        },
      }),
    ).toMatchObject({
      designation: 'ORSA STACKMORA 3:12>1',
      municipality: 'Orsa',
      areaM2: 5962,
      centroid: { lat: expect.any(Number), lng: expect.any(Number) },
    });
  });
});
