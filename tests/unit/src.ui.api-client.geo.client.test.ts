import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfTokenCache } from '../../services/csrfClient';

const coreApiMocks = vi.hoisted(() => ({
  callApi: vi.fn(),
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: coreApiMocks.callApi,
}));

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
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns property info result on success', async () => {
    coreApiMocks.callApi.mockResolvedValueOnce({
      ok: true,
      result: { designation: 'X', municipality: 'Y' },
    });

    await expect(fetchPropertyInfo('1:23', 'project-1')).resolves.toEqual({
      id: 'X',
      designation: 'X',
      municipality: 'Y',
      areaM2: undefined,
      geometry: undefined,
      centroid: undefined,
    });

    const [url, init] = coreApiMocks.callApi.mock.calls[0];
    expect(url).toBe('/api/property/lookup');
    expect(init.method).toBe('POST');
    expect(init.body).toEqual({
      propertyDesignation: '1:23',
      projectId: 'project-1',
      purpose: 'GEO_CLIENT',
    });
  });

  it('throws API error messages for property lookup and dynamic layers', async () => {
    coreApiMocks.callApi.mockRejectedValueOnce(new Error('lookup failed'));
    global.fetch = vi
      .fn()
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

  it('GEO-PROPERTY-CLIENT-RECOVERY-01: the raw WGS84 GeoJSON geometry roundtrips unchanged into PropertyInfo.geometry -- presentation-only, never re-derived or transformed client-side', () => {
    const wgs84Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [14.66, 61.13],
          [14.67, 61.13],
          [14.67, 61.14],
          [14.66, 61.13],
        ],
      ],
    };
    const result = mapLookupResultToPropertyInfo({
      designation: 'ORSA STACKMORA 3:12>1',
      geometry: wgs84Polygon,
      boundaries: { properties: { municipalityName: 'Orsa', area: 5962 } },
    });
    expect(result.geometry).toBe(wgs84Polygon);
  });

  it('GEO-PROPERTY-CLIENT-RECOVERY-01: falls back to boundaries.geometry when no top-level geometry is present, still the same WGS84 object', () => {
    const wgs84Point = { type: 'Point', coordinates: [14.66, 61.13] };
    const result = mapLookupResultToPropertyInfo({
      designation: 'ORSA STACKMORA 3:12>1',
      boundaries: { geometry: wgs84Point, properties: { municipalityName: 'Orsa' } },
    });
    expect(result.geometry).toBe(wgs84Point);
  });
});
