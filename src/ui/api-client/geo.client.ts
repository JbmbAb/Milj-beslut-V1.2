/**
 * GEO API CLIENT
 * Anropar /api/property/lookup (lantmaterietService via property.routes).
 */

import type { PropertyInfo } from '../../domain/geo';
import { csrfFetch } from '../../../services/csrfClient';

const ADMIN_BEARER_KEY = 'miljobeslut_admin_bearer';

type GeoJsonGeometry = {
  type?: string;
  coordinates?: unknown;
  geometry?: GeoJsonGeometry;
  properties?: Record<string, unknown>;
};

function centroidFromGeometry(geometry: unknown): { lat: number; lng: number } | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as GeoJsonGeometry;

  if (g.type === 'Feature' && g.geometry) {
    return centroidFromGeometry(g.geometry);
  }

  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const [lng, lat] = g.coordinates as number[];
    return { lat, lng };
  }

  if (g.type === 'Polygon' && Array.isArray(g.coordinates?.[0])) {
    const ring = g.coordinates[0] as number[][];
    if (ring.length === 0) return null;
    let sumLng = 0;
    let sumLat = 0;
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
    }
    return { lat: sumLat / ring.length, lng: sumLng / ring.length };
  }

  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates?.[0]?.[0])) {
    return centroidFromGeometry({ type: 'Polygon', coordinates: g.coordinates[0] });
  }

  return null;
}

/** Normaliserar /api/property/lookup till PropertyInfo med centroid från geometri. */
export function mapLookupResultToPropertyInfo(raw: Record<string, unknown>): PropertyInfo {
  const boundaries = raw.boundaries as GeoJsonGeometry | undefined;
  const boundaryProps = boundaries?.properties ?? {};
  const designation = String(
    raw.designation ?? raw.normalizedDesignation ?? raw.requestedDesignation ?? '',
  ).trim();
  const municipality = String(
    boundaryProps.municipalityName ?? boundaryProps.kommunnamn ?? raw.municipality ?? '',
  ).trim();
  const geometry = raw.geometry ?? boundaries?.geometry ?? boundaries;
  const existingCentroid = raw.centroid as { lat?: number; lng?: number } | undefined;
  const centroid =
    existingCentroid &&
    typeof existingCentroid.lat === 'number' &&
    typeof existingCentroid.lng === 'number'
      ? { lat: existingCentroid.lat, lng: existingCentroid.lng }
      : centroidFromGeometry(geometry);

  return {
    id: String(raw.source_key ?? raw.id ?? (designation || 'unknown')),
    designation,
    municipality,
    areaM2: typeof boundaryProps.area === 'number' ? boundaryProps.area : undefined,
    centroid: centroid ?? undefined,
  };
}

export async function fetchPropertyInfo(designation: string, projectId?: string): Promise<PropertyInfo> {
  const token = typeof window !== 'undefined' ? (window.localStorage.getItem(ADMIN_BEARER_KEY) ?? '') : '';
  const response = await csrfFetch('/api/property/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      propertyDesignation: designation,
      projectId: projectId ?? '',
      purpose: 'GEO_CLIENT',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Fastighetsuppslag misslyckades');
  }

  const data = await response.json();
  const raw = data.result;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Fastighetsuppslag returnerade ogiltigt svar');
  }
  return mapLookupResultToPropertyInfo(raw as Record<string, unknown>);
}

export async function fetchSpatialAudit(lat: number, lng: number): Promise<string> {
  const response = await csrfFetch('/api/spatial-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  });
  if (!response.ok) throw new Error('Spatial audit misslyckades');
  const data = await response.json();
  return data.text || 'Ingen spatial analys tillgänglig.';
}

export async function fetchDynamicLayer(endpoint: string, bbox: string): Promise<any> {
  const response = await fetch(`${endpoint}?bbox=${encodeURIComponent(bbox)}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Kunde inte ladda kartlager');
  }
  return await response.json();
}

export type MapLayerCatalogEntry = {
  key: string;
  label: string;
  endpoint: string;
  bboxRequired: boolean;
  geometry: 'polygon' | 'line' | 'point' | 'mixed';
  source: 'postgis' | 'external' | 'hybrid';
  provider: string;
  activation: 'IMMEDIATE' | 'PERMIT_REQUIRED';
  description?: string;
  documentationUrls?: string[];
  datasetStyle?: string;
  minZoom?: number;
};

export async function fetchMapLayerCatalog(): Promise<MapLayerCatalogEntry[]> {
  const response = await fetch('/api/reference/map-layers', { credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Kunde inte ladda kartlagerkatalog');
  }
  if (!Array.isArray(data?.layers)) {
    throw new Error('Kartlagerkatalogen har ogiltigt format');
  }
  return data.layers as MapLayerCatalogEntry[];
}

export type OgcCatalogSummary = {
  id: string;
  label: string;
  provider: string;
  service: 'WMS' | 'WFS';
  description?: string;
  capabilitiesUrl: string;
  supportsMapToggle: boolean;
};

export type OgcFederatedMapLayer = {
  name: string;
  title?: string;
  abstract?: string;
  mapMode: 'wms_tile' | 'wfs_info';
  layerKey: string;
  wms?: { baseUrl: string; layers: string; version: string };
};

export async function fetchOgcCatalogSummaries(): Promise<OgcCatalogSummary[]> {
  const response = await fetch('/api/reference/ogc-catalogs', { credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Kunde inte ladda OGC-kataloger');
  }
  if (!Array.isArray(data?.catalogs)) {
    throw new Error('OGC-katalogsvar har ogiltigt format');
  }
  return data.catalogs as OgcCatalogSummary[];
}

export async function fetchOgcCatalogLayers(catalogId: string): Promise<{
  layers: OgcFederatedMapLayer[];
  warning?: string;
}> {
  const response = await fetch(`/api/reference/ogc-catalogs/${encodeURIComponent(catalogId)}/layers`, {
    credentials: 'same-origin',
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Kunde inte ladda OGC-lager');
  }
  return {
    layers: Array.isArray(data?.layers) ? (data.layers as OgcFederatedMapLayer[]) : [],
    warning: typeof data?.warning === 'string' ? data.warning : undefined,
  };
}
