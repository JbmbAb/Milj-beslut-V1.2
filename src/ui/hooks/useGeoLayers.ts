import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchDynamicLayer,
  fetchMapLayerCatalog,
  fetchSpatialAudit,
  type MapLayerCatalogEntry,
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
