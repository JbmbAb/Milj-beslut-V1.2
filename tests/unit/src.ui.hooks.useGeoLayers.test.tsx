import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useDynamicLayer,
  useMapLayerCatalog,
  useOgcFederatedMapLayers,
  useSpatialAudit,
} from '../../src/ui/hooks/useGeoLayers';
import { usePropertyInfo } from '../../src/ui/hooks/usePropertyInfo';

const geoMocks = vi.hoisted(() => ({
  fetchDynamicLayer: vi.fn(),
  fetchMapLayerCatalog: vi.fn(),
  fetchOgcCatalogSummaries: vi.fn(),
  fetchOgcCatalogLayers: vi.fn(),
  fetchPropertyInfo: vi.fn(),
  fetchSpatialAudit: vi.fn(),
}));

vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchDynamicLayer: geoMocks.fetchDynamicLayer,
  fetchMapLayerCatalog: geoMocks.fetchMapLayerCatalog,
  fetchOgcCatalogSummaries: geoMocks.fetchOgcCatalogSummaries,
  fetchOgcCatalogLayers: geoMocks.fetchOgcCatalogLayers,
  fetchPropertyInfo: geoMocks.fetchPropertyInfo,
  fetchSpatialAudit: geoMocks.fetchSpatialAudit,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('src/ui/hooks/useGeoLayers + usePropertyInfo', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('disables dynamic layer queries without bbox and fetches once bbox exists', async () => {
    geoMocks.fetchDynamicLayer.mockResolvedValue({ type: 'FeatureCollection', features: [] });
    const wrapper = createWrapper();

    const disabled = renderHook(() => useDynamicLayer('sgu', '/api/layer', null), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(geoMocks.fetchDynamicLayer).not.toHaveBeenCalled();

    const enabled = renderHook(() => useDynamicLayer('sgu', '/api/layer', '1,2,3,4'), { wrapper });
    await waitFor(() => {
      expect(enabled.result.current.data).toEqual({ type: 'FeatureCollection', features: [] });
    });

    expect(geoMocks.fetchDynamicLayer).toHaveBeenCalledWith('/api/layer', '1,2,3,4');
  });

  it('runs spatial audit mutations', async () => {
    geoMocks.fetchSpatialAudit.mockResolvedValue('Spatial summary');
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSpatialAudit(), { wrapper });

    await result.current.mutateAsync({ lat: 59.3, lng: 18.1 });

    expect(geoMocks.fetchSpatialAudit).toHaveBeenCalledWith(59.3, 18.1);
  });

  it('loads the map layer catalog', async () => {
    geoMocks.fetchMapLayerCatalog.mockResolvedValue([{ key: 'postgis_nvr', label: 'Skyddad natur' }]);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useMapLayerCatalog(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual([{ key: 'postgis_nvr', label: 'Skyddad natur' }]);
    });

    expect(geoMocks.fetchMapLayerCatalog).toHaveBeenCalledOnce();
  });

  it('loads property info only for long enough designations', async () => {
    geoMocks.fetchPropertyInfo.mockResolvedValue({ designation: '1:23' });
    const wrapper = createWrapper();

    const disabled = renderHook(() => usePropertyInfo('AB'), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');

    const enabled = renderHook(() => usePropertyInfo('1:23', 'project-1'), { wrapper });
    await waitFor(() => {
      expect(enabled.result.current.data).toEqual({ designation: '1:23' });
    });

    expect(geoMocks.fetchPropertyInfo).toHaveBeenCalledWith('1:23', 'project-1');
  });
});

describe('useOgcFederatedMapLayers', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('merges WMS tile layers from federated catalogs and collects warnings', async () => {
    geoMocks.fetchOgcCatalogSummaries.mockResolvedValue([
      { id: 'lst_geoserver_wms', label: 'LST GeoServer', supportsMapToggle: true },
      { id: 'viss_wms', label: 'VISS', supportsMapToggle: false },
    ]);
    geoMocks.fetchOgcCatalogLayers.mockResolvedValue({
      layers: [
        {
          name: 'lst:water',
          title: 'Vatten',
          mapMode: 'wms_tile',
          layerKey: 'lst:water',
          wms: { baseUrl: 'https://example/wms', layers: 'water', version: '1.3.0' },
        },
        {
          name: 'lst:vector',
          title: 'Vektor',
          mapMode: 'geojson_bbox',
          layerKey: 'lst:vector',
        },
      ],
      warning: 'Capabilities stale',
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useOgcFederatedMapLayers(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.wmsLayers).toHaveLength(1);
    expect(result.current.wmsLayers[0]?.name).toBe('lst:water');
    expect(result.current.catalogLabelById.get('lst_geoserver_wms')).toBe('LST GeoServer');
    expect(result.current.warnings).toEqual(['Capabilities stale']);
    expect(geoMocks.fetchOgcCatalogLayers).toHaveBeenCalledWith('lst_geoserver_wms');
    expect(geoMocks.fetchOgcCatalogLayers).not.toHaveBeenCalledWith('viss_wms');
  });

  it('surfaces error state when catalog summaries fail', async () => {
    geoMocks.fetchOgcCatalogSummaries.mockRejectedValue(new Error('network down'));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useOgcFederatedMapLayers(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.wmsLayers).toEqual([]);
  });
});
