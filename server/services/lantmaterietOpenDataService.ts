/**
 * lantmaterietOpenDataService.ts
 *
 * Gemensam klient mot Lantmäteriets avgiftsfria tjänster (Open Data).
 * Miljöbeslut är godkänd för alla avgiftsfria tjänster; varje produkt kräver
 * dock oftast en prenumerationsnyckel från API-portalen.
 *
 * Vi samlar dem här i stället för att sprida förfrågningslogiken över hela
 * kodbasen. Varje funktion är idempotent och fail-soft: om en nyckel saknas
 * returneras ett strukturerat felobjekt.
 *
 * Källor (2026-04):
 *  - https://api.lantmateriet.se/distribution/produkter/
 *  - https://api.lantmateriet.se/open/
 *  - https://www.lantmateriet.se/sv/geodata/apier/
 */

import { logger } from '../logger';

export type OpenDataProduct =
  | 'fastighetsindelning' // Fastighetsgränser + registerbeteckningar (OGC Features)
  | 'belagenhetsadress' // Belägenhetsadresser (OGC Features)
  | 'ortnamn' // Geografiska namn (WFS/OGC)
  | 'hojdmodell' // Laserdata & höjdmodell (Atom feed)
  | 'topowebb' // Topografisk webbkarta (WMTS/WMS)
  | 'ortofoto' // Ortofoto (WMS)
  | 'terrangskuggning' // Terrängskuggning (WMS)
  | 'administrativindelning' // Administrativ indelning (WMS + OGC)
  | 'hojdgrid'; // Öppen höjddata (Atom)

export interface OpenDataProductDefinition {
  product: OpenDataProduct;
  name: string;
  subscription: 'required' | 'none';
  format: 'OGC_FEATURES' | 'WMTS' | 'WMS' | 'ATOM' | 'WFS';
  baseUrl: string;
  description: string;
  sampleEndpoint?: string;
}

export const OPEN_DATA_CATALOG: OpenDataProductDefinition[] = [
  {
    product: 'fastighetsindelning',
    name: 'Fastighetsindelning (öppen)',
    subscription: 'required',
    format: 'OGC_FEATURES',
    baseUrl:
      process.env.LANTMATERIET_OPEN_FASTIGHET_URL ||
      'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning',
    description:
      'Fastighetsgränser och registerbeteckningar via OGC API Features. Kräver prenumerationsnyckel.',
    sampleEndpoint: '/collections/registerenhetsomradesytor/items?limit=1',
  },
  {
    product: 'belagenhetsadress',
    name: 'Belägenhetsadress (öppen)',
    subscription: 'required',
    format: 'OGC_FEATURES',
    baseUrl:
      process.env.LANTMATERIET_OPEN_ADRESS_URL ||
      'https://api.lantmateriet.se/ogc-features/v1/belagenhetsadress',
    description: 'Belägenhetsadresser via OGC API Features.',
    sampleEndpoint: '/collections/adressplatser/items?limit=1',
  },
  {
    product: 'ortnamn',
    name: 'Ortnamn (öppen)',
    subscription: 'required',
    format: 'OGC_FEATURES',
    baseUrl:
      process.env.LANTMATERIET_OPEN_ORTNAMN_URL || 'https://api.lantmateriet.se/ogc-features/v1/ortnamn',
    description: 'Geografiska namn via OGC API Features.',
    sampleEndpoint: '/collections/ortnamn/items?limit=1',
  },
  {
    product: 'hojdmodell',
    name: 'Höjdmodell + laserdata (öppen)',
    subscription: 'none',
    format: 'ATOM',
    baseUrl: process.env.LANTMATERIET_OPEN_HOJD_ATOM_URL || 'https://download-opendata.lantmateriet.se/',
    description: 'Öppen laserdata och höjdmodell via Atom/FTP-feeds (bulk).',
  },
  {
    product: 'topowebb',
    name: 'Topografisk webbkarta (topowebb-ccby)',
    subscription: 'required',
    format: 'WMTS',
    baseUrl:
      process.env.LANTMATERIET_OPEN_TOPOWEBB_URL || 'https://api.lantmateriet.se/open/topowebb-ccby/v1/wmts',
    description: 'Topografisk bakgrundskarta (WMTS/WMS). CC-BY-licens.',
    sampleEndpoint: '?request=GetCapabilities&version=1.0.0&service=wmts',
  },
  {
    product: 'ortofoto',
    name: 'Ortofoto (ortofoto-ccby)',
    subscription: 'required',
    format: 'WMS',
    baseUrl:
      process.env.LANTMATERIET_OPEN_ORTOFOTO_URL || 'https://api.lantmateriet.se/open/ortofoto-ccby/v1/wms',
    description: 'Ortofoto-bakgrund (WMS). CC-BY-licens.',
    sampleEndpoint: '?request=GetCapabilities&service=WMS',
  },
  {
    product: 'terrangskuggning',
    name: 'Terrängskuggning',
    subscription: 'required',
    format: 'WMS',
    baseUrl:
      process.env.LANTMATERIET_OPEN_TERRANG_URL || 'https://api.lantmateriet.se/open/terrangskuggning/v1/wms',
    description: 'Terrängskuggning för GIS-bakgrund.',
    sampleEndpoint: '?request=GetCapabilities&service=WMS',
  },
  {
    product: 'administrativindelning',
    name: 'Administrativ indelning (öppen)',
    subscription: 'required',
    format: 'OGC_FEATURES',
    baseUrl:
      process.env.LANTMATERIET_OPEN_ADMIN_URL ||
      'https://api.lantmateriet.se/ogc-features/v1/administrativindelning',
    description: 'Kommungränser, länsgränser, landsgräns m.fl.',
    sampleEndpoint: '/collections/kommun/items?limit=1',
  },
  {
    product: 'hojdgrid',
    name: 'Höjdgrid (Atom bulk)',
    subscription: 'none',
    format: 'ATOM',
    baseUrl: process.env.LANTMATERIET_OPEN_HOJDGRID_ATOM || 'https://download-opendata.lantmateriet.se/',
    description: 'Höjdgrid 2+ och 50+ som Atom-feed för bulknedladdning.',
  },
];

function resolveSubscriptionKey(): string | null {
  const primary = String(process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY || '').trim();
  if (primary) return primary;
  // Fallback: om användaren har samma nyckel lagrad som API_KEY.
  const legacy = String(process.env.LANTMATERIET_API_KEY || '').trim();
  return legacy || null;
}

function decorateUrl(baseUrl: string, path: string | undefined, key: string | null): string {
  const fullUrl = path ? `${baseUrl.replace(/\/+$/, '')}${path}` : baseUrl;
  if (!key) return fullUrl;
  const separator = fullUrl.includes('?') ? '&' : '?';
  return `${fullUrl}${separator}subscription-key=${encodeURIComponent(key)}`;
}

export interface OpenDataStatusResult {
  product: OpenDataProduct;
  name: string;
  subscription: 'required' | 'none';
  format: OpenDataProductDefinition['format'];
  endpoint: string;
  ok: boolean;
  httpStatus?: number;
  reason?: string;
  samplePreview?: string;
}

/**
 * Kör en lätt GetCapabilities / ping per produkt. Används av
 * /api/datasources/lantmateriet/open/status och smoketest.
 */
export async function pingOpenDataProduct(product: OpenDataProduct): Promise<OpenDataStatusResult> {
  const definition = OPEN_DATA_CATALOG.find((d) => d.product === product);
  if (!definition) {
    return {
      product,
      name: product,
      subscription: 'required',
      format: 'OGC_FEATURES',
      endpoint: '',
      ok: false,
      reason: 'Okänd Lantmäteriet-produkt',
    };
  }

  const key = definition.subscription === 'required' ? resolveSubscriptionKey() : null;
  if (definition.subscription === 'required' && !key) {
    return {
      product,
      name: definition.name,
      subscription: definition.subscription,
      format: definition.format,
      endpoint: definition.baseUrl,
      ok: false,
      reason: 'LANTMATERIET_OPEN_SUBSCRIPTION_KEY saknas (krävs för denna produkt)',
    };
  }

  const endpoint = decorateUrl(definition.baseUrl, definition.sampleEndpoint, key);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json, application/geo+json, */*' },
      signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    return {
      product,
      name: definition.name,
      subscription: definition.subscription,
      format: definition.format,
      endpoint,
      ok: response.ok,
      httpStatus: response.status,
      samplePreview: text.slice(0, 180),
      reason: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (err) {
    logger.warn('lantmateriet-open-data: ping fail', {
      product,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      product,
      name: definition.name,
      subscription: definition.subscription,
      format: definition.format,
      endpoint,
      ok: false,
      reason: err instanceof Error ? err.message : 'Nätverksfel',
    };
  }
}

export async function pingAllOpenDataProducts(): Promise<OpenDataStatusResult[]> {
  return Promise.all(OPEN_DATA_CATALOG.map((d) => pingOpenDataProduct(d.product)));
}

export function listOpenDataCatalog(): OpenDataProductDefinition[] {
  return OPEN_DATA_CATALOG.map((d) => ({ ...d }));
}

export async function getLantmaterietOpenMapStatus(): Promise<string> {
  const openMode = String(process.env.LANTMATERIET_OPEN_MODE || '').toLowerCase() === 'true';
  if (openMode) return 'real';
  const key = process.env.LANTMATERIET_CONSUMER_KEY || '';
  return key ? 'real' : 'mock';
}
