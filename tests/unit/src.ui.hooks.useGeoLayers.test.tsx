import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDynamicLayer, useMapLayerCatalog, useSpatialAudit } from '../../src/ui/hooks/useGeoLayers';
import { usePropertyInfo } from '../../src/ui/hooks/usePropertyInfo';

const geoMocks = vi.hoisted(() => ({
  fetchDynamicLayer: vi.fn(),
  fetchMapLayerCatalog: vi.fn(),
  fetchPropertyInfo: vi.fn(),
  fetchSpatialAudit: vi.fn(),
}));

vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchDynamicLayer: geoMocks.fetchDynamicLayer,
  fetchMapLayerCatalog: geoMocks.fetchMapLayerCatalog,
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
