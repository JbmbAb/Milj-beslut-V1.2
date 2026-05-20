/**
 * GEO API CLIENT
 * Anropar /api/property/lookup (lantmaterietService via property.routes).
 */

import type { PropertyInfo } from '../../domain/geo';
import { csrfFetch } from '../../../services/csrfClient';

const ADMIN_BEARER_KEY = 'miljobeslut_admin_bearer';

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
  return data.result;
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
