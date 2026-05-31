/**
 * Hämtar och parsar WMS/WFS GetCapabilities för federerade myndighetstjänster.
 */

import { XMLParser } from 'fast-xml-parser';
import {
  findOgcFederatedCatalog,
  listOgcFederatedCatalogs,
  type OgcFederatedCatalogDefinition,
  type OgcServiceType,
} from '../datasources/ogcFederatedCatalogRegistry';

const REQUEST_HEADERS = {
  Accept: 'application/xml, text/xml, */*',
  'User-Agent': 'Miljöbeslut/2.0 (+https://miljobeslut.se)',
};

const CAPABILITIES_TTL_MS = 1000 * 60 * 60 * 6; // 6 h

type CapabilitiesCacheEntry = {
  fetchedAt: number;
  layers: OgcCatalogLayer[];
};

const capabilitiesCache = new Map<string, CapabilitiesCacheEntry>();

export interface OgcCatalogLayer {
  name: string;
  title?: string;
  abstract?: string;
  /** WMS kan visas direkt i kartan; WFS listas för import/vektor */
  mapMode: 'wms_tile' | 'wfs_info';
  layerKey: string;
  wms?: {
    baseUrl: string;
    layers: string;
    version: string;
  };
}

export interface OgcCatalogLayersResponse {
  catalog: OgcFederatedCatalogDefinition;
  layers: OgcCatalogLayer[];
  fetchedAt: string;
  cached: boolean;
  warning?: string;
}

function buildCapabilitiesUrl(catalog: OgcFederatedCatalogDefinition): string {
  const url = new URL(catalog.baseUrl.includes('?') ? catalog.baseUrl.split('?')[0] : catalog.baseUrl);
  url.searchParams.set('SERVICE', catalog.service);
  url.searchParams.set('REQUEST', 'GetCapabilities');
  url.searchParams.set('VERSION', catalog.version);
  return url.toString();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim() || undefined;
  if (typeof node === 'object' && node !== null && '#text' in node) {
    const t = (node as Record<string, unknown>)['#text'];
    return typeof t === 'string' ? t.trim() || undefined : undefined;
  }
  return undefined;
}

function collectWmsLayers(node: unknown, out: Array<{ name: string; title?: string; abstract?: string }>): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  const name = textValue(record.Name);
  const title = textValue(record.Title);
  const abstract = textValue(record.Abstract);
  const hasChildLayers = asArray(record.Layer).length > 0;
  if (name && !hasChildLayers && name.toLowerCase() !== 'wms') {
    out.push({ name, title, abstract });
  }

  for (const layer of asArray(record.Layer)) {
    collectWmsLayers(layer, out);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'Layer' || key === 'Name' || key === 'Title' || key === 'Abstract') continue;
    if (Array.isArray(value)) {
      for (const item of value) collectWmsLayers(item, out);
    } else {
      collectWmsLayers(value, out);
    }
  }
}

function collectWfsFeatureTypes(
  node: unknown,
  out: Array<{ name: string; title?: string; abstract?: string }>,
): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  const featureTypes = asArray(record.FeatureType);
  for (const ft of featureTypes) {
    if (!ft || typeof ft !== 'object') continue;
    const f = ft as Record<string, unknown>;
    const name = textValue(f.Name);
    const title = textValue(f.Title);
    const abstract = textValue(f.Abstract);
    if (name) out.push({ name, title, abstract });
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      collectWfsFeatureTypes(value, out);
    }
  }
}

function parseCapabilitiesXml(xml: string, service: OgcServiceType): Array<{ name: string; title?: string; abstract?: string }> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const collected: Array<{ name: string; title?: string; abstract?: string }> = [];

  if (service === 'WMS') {
    collectWmsLayers(doc, collected);
  } else {
    collectWfsFeatureTypes(doc, collected);
  }

  const seen = new Set<string>();
  return collected.filter((item) => {
    const key = item.name.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MAX_WMS_LAYERS_IN_RESPONSE = 120;

function toPublicLayer(catalog: OgcFederatedCatalogDefinition, layer: { name: string; title?: string; abstract?: string }): OgcCatalogLayer {
  const mapMode = catalog.service === 'WMS' ? 'wms_tile' : 'wfs_info';
  const safeName = encodeURIComponent(layer.name);
  const layerKey = `ogc_${catalog.service.toLowerCase()}:${catalog.id}:${safeName}`;
  return {
    name: layer.name,
    title: layer.title,
    abstract: layer.abstract,
    mapMode,
    layerKey,
    ...(mapMode === 'wms_tile'
      ? {
          wms: {
            baseUrl: catalog.baseUrl,
            layers: layer.name,
            version: catalog.version,
          },
        }
      : {}),
  };
}

export function listOgcCatalogSummaries() {
  return listOgcFederatedCatalogs().map((catalog) => ({
    id: catalog.id,
    label: catalog.label,
    provider: catalog.provider,
    service: catalog.service,
    description: catalog.description,
    capabilitiesUrl: buildCapabilitiesUrl(catalog),
    supportsMapToggle: catalog.service === 'WMS',
  }));
}

export async function getOgcCatalogLayers(catalogId: string): Promise<OgcCatalogLayersResponse> {
  const catalog = findOgcFederatedCatalog(catalogId);
  if (!catalog) {
    throw new Error(`Okänd OGC-katalog: ${catalogId}`);
  }

  const cached = capabilitiesCache.get(catalogId);
  if (cached && Date.now() - cached.fetchedAt < CAPABILITIES_TTL_MS) {
    return {
      catalog,
      layers: cached.layers,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      cached: true,
    };
  }

  const url = buildCapabilitiesUrl(catalog);
  let warning: string | undefined;
  let parsed: Array<{ name: string; title?: string; abstract?: string }> = [];

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(25000),
    });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    parsed = parseCapabilitiesXml(xml, catalog.service);
    if (parsed.length === 0) {
      warning = 'GetCapabilities svarade men inga lager kunde parsas.';
    }
  } catch (error: unknown) {
    warning = error instanceof Error ? error.message : String(error);
    parsed = [];
  }

  let layers = parsed.map((layer) => toPublicLayer(catalog, layer));
  if (catalog.service === 'WMS' && layers.length > MAX_WMS_LAYERS_IN_RESPONSE) {
    layers = layers.slice(0, MAX_WMS_LAYERS_IN_RESPONSE);
    warning = warning
      ? `${warning}; endast ${MAX_WMS_LAYERS_IN_RESPONSE} första WMS-lager returneras`
      : `Endast ${MAX_WMS_LAYERS_IN_RESPONSE} första WMS-lager returneras`;
  }
  capabilitiesCache.set(catalogId, { fetchedAt: Date.now(), layers });

  return {
    catalog,
    layers,
    fetchedAt: new Date().toISOString(),
    cached: false,
    warning,
  };
}

/** Endast för tester – rensar GetCapabilities-cache. */
export function resetOgcCapabilitiesCache(): void {
  capabilitiesCache.clear();
}

export function resolveOgcWmsLayerConfig(layerKey: string): {
  catalogId: string;
  layerName: string;
  baseUrl: string;
  version: string;
} | null {
  const match = /^ogc_wms:([^:]+):(.+)$/.exec(layerKey);
  if (!match) return null;
  const catalogId = match[1];
  const layerName = decodeURIComponent(match[2]);
  const catalog = findOgcFederatedCatalog(catalogId);
  if (!catalog || catalog.service !== 'WMS') return null;
  return {
    catalogId,
    layerName,
    baseUrl: catalog.baseUrl,
    version: catalog.version,
  };
}
