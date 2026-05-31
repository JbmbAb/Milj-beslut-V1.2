import { useMemo } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import {
  fetchDynamicLayer,
  fetchMapLayerCatalog,
  fetchOgcCatalogLayers,
  fetchOgcCatalogSummaries,
  fetchSpatialAudit,
  type MapLayerCatalogEntry,
  type OgcFederatedMapLayer,
} from '../api-client/geo.client';

export function useSpatialAudit() {
  return useMutation({
    mutationFn: (vars: { lat: number; lng: number }) => fetchSpatialAudit(vars.lat, vars.lng),
  });
}

export function useDynamicLayer(layerKey: string, endpoint: string, bbox: string | null) {
  return useQuery({
    queryKey: ['geoLayer', layerKey, bbox],
    queryFn: () => fetchDynamicLayer(endpoint, bbox!),
    enabled: !!bbox && !!layerKey,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useMapLayerCatalog() {
  return useQuery<MapLayerCatalogEntry[]>({
    queryKey: ['mapLayerCatalog'],
    queryFn: fetchMapLayerCatalog,
    staleTime: 1000 * 60 * 15,
  });
}

export function useOgcFederatedMapLayers() {
  const catalogsQuery = useQuery({
    queryKey: ['ogcCatalogSummaries'],
    queryFn: fetchOgcCatalogSummaries,
    staleTime: 1000 * 60 * 60,
  });

  const wmsCatalogIds = useMemo(
    () => (catalogsQuery.data ?? []).filter((c) => c.supportsMapToggle).map((c) => c.id),
    [catalogsQuery.data],
  );

  const layerQueries = useQueries({
    queries: wmsCatalogIds.map((catalogId) => ({
      queryKey: ['ogcCatalogLayers', catalogId],
      queryFn: () => fetchOgcCatalogLayers(catalogId),
      staleTime: 1000 * 60 * 60 * 6,
      retry: 1,
    })),
  });

  const wmsLayers = useMemo(() => {
    const merged: OgcFederatedMapLayer[] = [];
    for (const query of layerQueries) {
      const layers = query.data?.layers ?? [];
      for (const layer of layers) {
        if (layer.mapMode === 'wms_tile' && layer.wms) {
          merged.push(layer);
        }
      }
    }
    return merged;
  }, [layerQueries]);

  const catalogLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const catalog of catalogsQuery.data ?? []) {
      map.set(catalog.id, catalog.label);
    }
    return map;
  }, [catalogsQuery.data]);

  const warnings = useMemo(
    () =>
      layerQueries
        .map((q) => q.data?.warning)
        .filter((w): w is string => typeof w === 'string' && w.length > 0),
    [layerQueries],
  );

  const isLoading = catalogsQuery.isLoading || layerQueries.some((q) => q.isLoading);
  const isError = catalogsQuery.isError || layerQueries.some((q) => q.isError);

  return {
    wmsLayers,
    catalogLabelById,
    warnings,
    isLoading,
    isError,
  };
}
