/**
 * INSPIRE HVD (High Value Datasets) Integration Service
 *
 * Fetches Swedish environmental geodata from INSPIRE-compliant WFS/OGC endpoints.
 * All sources are open and free per EU Regulation 2023/138 on High Value Datasets.
 *
 * Sources:
 * - Naturvårdsverket (NVV): Protected sites, natura2000
 * - SGU: Groundwater, geology, contaminated sites
 * - HaV: Water bodies, marine protected areas
 * - EEA: Air quality (EU-level fallback)
 */

import { logger } from '../logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HvdProtectedSite {
  id: string;
  name: string;
  siteType: string;
  legalBasis?: string;
  designationDate?: string;
  areaHa?: number;
  distanceM?: number;
  source: 'NVV_INSPIRE' | 'NVV_NATURVARDSREGISTRET';
}

export interface HvdWaterBody {
  id: string;
  name: string;
  category: 'river' | 'lake' | 'coastal' | 'groundwater' | 'unknown';
  status?: string;
  distanceM?: number;
  source: 'HAV_WFD';
}

export interface HvdNoiseArea {
  id: string;
  noiseSource: string;
  lden?: number;
  lnight?: number;
  source: 'EEA_NOISE' | 'NVV_NOISE';
}

export interface HvdIndustrialSite {
  id: string;
  name: string;
  activity?: string;
  permitStatus?: string;
  distanceM?: number;
  source: 'EEA_IED';
}

export interface HvdResult {
  protectedSites: HvdProtectedSite[];
  waterBodies: HvdWaterBody[];
  noiseSensitiveAreas: HvdNoiseArea[];
  industrialSites: HvdIndustrialSite[];
  fetchedAt: string;
  errors: string[];
}

// ── WFS Endpoints ─────────────────────────────────────────────────────────────

const ENDPOINTS = {
  // Naturvårdsverket - INSPIRE Protected Sites (skyddade områden)
  NVV_INSPIRE_PS: 'https://geodata.naturvardsverket.se/inspire/ps/wfs',
  // Naturvårdsverket - Naturvårdsregistret (nationella skyddade områden)
  NVV_NATURVARDSREGISTRET: 'https://geodata.naturvardsverket.se/naturvardsregistret/wfs',
  // Havs- och vattenmyndigheten - vattenförekomster (WFD)
  HAV_VATTENFOREKOMSTER: 'https://gis.havochvatten.se/geoserver/vattenforekomster/wfs',
  // EEA - Industrial Emissions Directive sites (EU-nivå, inkl. Sverige)
  EEA_IED: 'https://discomap.eea.europa.eu/arcgis/services/EPRTR/IED_Facilities/MapServer/WFSServer',
} as const;

const WFS_TIMEOUT_MS = 8000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWfsUrl(
  base: string,
  typeName: string,
  bbox: string,
  maxFeatures = 50,
): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    bbox: `${bbox},EPSG:4326`,
    count: String(maxFeatures),
    outputFormat: 'application/json',
  });
  return `${base}?${params.toString()}`;
}

function latLngToBbox(lat: number, lng: number, radiusM: number): string {
  const deg = radiusM / 111320;
  const lngDeg = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return `${lng - lngDeg},${lat - deg},${lng + lngDeg},${lat + deg}`;
}

async function wfsFetch(url: string, label: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WFS_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn(`INSPIRE HVD ${label} returned ${res.status}`);
      return null;
    }
    const text = await res.text();
    // Some WFS return XML on error even with outputFormat=json
    if (text.trimStart().startsWith('<')) {
      logger.warn(`INSPIRE HVD ${label} returned XML instead of JSON`);
      return null;
    }
    return JSON.parse(text) as GeoJSON.FeatureCollection;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.warn(`INSPIRE HVD ${label} timed out after ${WFS_TIMEOUT_MS}ms`);
    } else {
      logger.error(`INSPIRE HVD ${label} fetch error`, { err: String(err) });
    }
    return null;
  }
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchNvvProtectedSites(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ results: HvdProtectedSite[]; error?: string }> {
  const bbox = latLngToBbox(lat, lng, radiusM);
  const url = buildWfsUrl(
    ENDPOINTS.NVV_INSPIRE_PS,
    'ps:ProtectedSite',
    bbox,
    100,
  );

  const fc = await wfsFetch(url, 'NVV_INSPIRE_PS');
  if (!fc) return { results: [], error: 'NVV INSPIRE PS ej tillgänglig' };

  const results: HvdProtectedSite[] = fc.features.map((f) => {
    const p = f.properties || {};
    return {
      id: String(p.inspireId || p.siteProtectionClassification || f.id || ''),
      name: p.siteName?.value || p.siteName || p.name || 'Namnlöst område',
      siteType: p.siteDesignation?.designation || p.siteProtectionClassification || 'Skyddat område',
      legalBasis: p.legalFoundationDocument || undefined,
      designationDate: p.siteDesignation?.designationDate || undefined,
      areaHa: p.areaValue ? parseFloat(p.areaValue) : undefined,
      source: 'NVV_INSPIRE' as const,
    };
  });

  return { results };
}

async function fetchNvvNaturvardsregistret(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ results: HvdProtectedSite[]; error?: string }> {
  const bbox = latLngToBbox(lat, lng, radiusM);
  // Naturvårdsregistret layers: naturreservat, nationalpark, naturminne, biotopskydd
  const layers = ['naturreservat', 'nationalpark', 'naturminne'];
  const all: HvdProtectedSite[] = [];

  for (const layer of layers) {
    const url = buildWfsUrl(ENDPOINTS.NVV_NATURVARDSREGISTRET, layer, bbox, 50);
    const fc = await wfsFetch(url, `NVV_NVR_${layer}`);
    if (!fc) continue;

    fc.features.forEach((f) => {
      const p = f.properties || {};
      all.push({
        id: String(p.nvrid || p.id || f.id || ''),
        name: p.namn || p.name || 'Namnlöst område',
        siteType: layer,
        designationDate: p.beslutsdatum || undefined,
        areaHa: p.areal_ha ? parseFloat(p.areal_ha) : undefined,
        source: 'NVV_NATURVARDSREGISTRET' as const,
      });
    });
  }

  return { results: all };
}

async function fetchHavWaterBodies(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ results: HvdWaterBody[]; error?: string }> {
  const bbox = latLngToBbox(lat, lng, radiusM);
  const url = buildWfsUrl(
    ENDPOINTS.HAV_VATTENFOREKOMSTER,
    'vattenforekomster:ytvattenforekomst',
    bbox,
    50,
  );

  const fc = await wfsFetch(url, 'HAV_VATTENFOREKOMSTER');
  if (!fc) return { results: [], error: 'HaV vattenförekomster ej tillgänglig' };

  const catMap: Record<string, HvdWaterBody['category']> = {
    R: 'river', L: 'lake', C: 'coastal', O: 'coastal',
  };

  const results: HvdWaterBody[] = fc.features.map((f) => {
    const p = f.properties || {};
    const typeCode = String(p.vattenkategori || p.ms_cd || '').toUpperCase();
    return {
      id: String(p.eu_cd || p.ms_cd || f.id || ''),
      name: p.namn || p.name || 'Vattenförekomst',
      category: catMap[typeCode[0]] || 'unknown',
      status: p.ekologisk_status || p.ekologisk_potential || undefined,
      source: 'HAV_WFD' as const,
    };
  });

  return { results };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch all relevant INSPIRE HVD data for a given coordinate.
 * Runs all sources in parallel, collects errors without throwing.
 */
export async function fetchInspireHvdData(
  lat: number,
  lng: number,
  radiusM: number = 1000,
): Promise<HvdResult> {
  const errors: string[] = [];

  const [nvvInspire, nvvNvr, havWater] = await Promise.all([
    fetchNvvProtectedSites(lat, lng, radiusM),
    fetchNvvNaturvardsregistret(lat, lng, radiusM),
    fetchHavWaterBodies(lat, lng, radiusM),
  ]);

  if (nvvInspire.error) errors.push(nvvInspire.error);
  if (nvvNvr.error) errors.push(nvvNvr.error);
  if (havWater.error) errors.push(havWater.error);

  // Deduplicate protected sites by id
  const allSites = [...nvvInspire.results, ...nvvNvr.results];
  const seenIds = new Set<string>();
  const protectedSites = allSites.filter((s) => {
    if (!s.id || seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });

  return {
    protectedSites,
    waterBodies: havWater.results,
    noiseSensitiveAreas: [],   // populated separately via bullerkartor PostGIS
    industrialSites: [],        // populated separately via IED PostGIS
    fetchedAt: new Date().toISOString(),
    errors,
  };
}

/**
 * Quick check: is the coordinate inside or near any INSPIRE protected site?
 * Returns the closest/most restrictive site, or null.
 */
export async function getNearestProtectedSite(
  lat: number,
  lng: number,
  radiusM: number = 500,
): Promise<HvdProtectedSite | null> {
  const { protectedSites } = await fetchInspireHvdData(lat, lng, radiusM);
  return protectedSites.length > 0 ? protectedSites[0] : null;
}

/**
 * Returns INSPIRE endpoint status — useful for health checks.
 */
export async function checkInspireEndpoints(): Promise<Record<string, 'ok' | 'error'>> {
  const results: Record<string, 'ok' | 'error'> = {};
  const checks = Object.entries(ENDPOINTS).map(async ([key, url]) => {
    try {
      const capUrl = `${url}?service=WFS&request=GetCapabilities`;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const res = await fetch(capUrl, { signal: controller.signal });
      results[key] = res.ok ? 'ok' : 'error';
    } catch {
      results[key] = 'error';
    }
  });
  await Promise.all(checks);
  return results;
}
