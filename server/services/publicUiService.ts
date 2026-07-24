import crypto from 'node:crypto';
import { SOURCE_CATALOG, type ActivationClass } from '../datasources/catalog';
import { prisma } from '../db/prisma';
import type { Bbox } from '../utils/geo/bbox';
import { fetchImmediateOpenSources } from './openDataSourceService';
import { SGU_LANDSLIDE_REVIEW_BUFFER_METERS, type SguCoverageMode } from './sguRiskService';
import { getDispatchProviderRuntimeStatus } from './transportDispatchService';
import { getSluProductStatus, pingSluProduct } from './sluService';

export { parseBbox, type Bbox } from '../utils/geo/bbox';

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJsonGeometry | null;
    properties: Record<string, unknown>;
  }>;
  meta?: Record<string, unknown>;
};

type RaaFeature = {
  id?: string;
  geometry?: GeoJsonGeometry | null;
  properties?: Record<string, unknown>;
};

type OpenSyncResult = Awaited<ReturnType<typeof fetchImmediateOpenSources>>[number];

type LocalNamedGeometryRow = {
  geojson: string;
  [key: string]: unknown;
};

type GroundLayerRow = {
  source_key: string;
  layer_code: number | null;
  layer_label: string | null;
  map_type: number | null;
  source_scale: string;
  geojson: string;
};

type LandslideRow = {
  source_key: string;
  feature_code: number | null;
  feature_label: string | null;
  symbol: number | null;
  geojson: string;
};

type SguWellLayerRow = {
  brunnsid: string | number | null;
  fastighet: string | null;
  kommunnamn: string | null;
  anvandning: string | null;
  totaldjup: number | null;
  jorddjup: number | null;
  kapacitet: number | null;
  geojson: string;
};

type SguPermeabilityLayerRow = {
  objectid: string | number | null;
  permeability_code: number | null;
  permeability_label: string | null;
  soil_code: number | null;
  soil_label: string | null;
  mapping_name: string | null;
  geojson: string;
};

type SguGroundwaterMagazineLayerRow = {
  id: string | number | null;
  name: string | null;
  aquifer_type: string | null;
  infiltration: string | null;
  saturated_zone: string | null;
  unsaturated_zone: string | null;
  geojson: string;
};

type SguGroundwaterBodyLayerRow = {
  eu_cd: string | null;
  ms_cd: string | null;
  name: string | null;
  water_body_type: string | null;
  viss_url: string | null;
  geojson: string;
};

type SguImportedLayerRow = {
  layer_key: string;
  layer_label: string;
  geometry_type: string | null;
  raw_properties: Record<string, unknown> | null;
  geojson: string;
};

type WaterCatchmentLayerRow = {
  varoid: string | null;
  ms_cd: string | null;
  name: string | null;
  category: string | null;
  area: number | null;
  geojson: string;
};

type WaterBodyRow = {
  external_id: string;
  name: string | null;
  water_type: string | null;
  status_ecological: string | null;
  status_chemical: string | null;
  distance_meters: number;
};

type HeritageRow = {
  external_id: string;
  object_type: string | null;
  name: string | null;
  protection_class: string | null;
  distance_meters: number;
};

type ClimateFloodRow = {
  external_id: string;
  source: string | null;
  return_period: string | null;
};

type ClimateFloodGeometryRow = ClimateFloodRow & {
  geojson: string;
};

type VissNearbyWater = {
  Name?: string;
  SwedishName?: string;
  EU_CD?: string;
  MS_CD?: string;
  UUID?: string;
  XCoordinate?: string;
  YCoordinate?: string;
  CoordinateFormat?: string;
  WaterCategory?: string;
  URL?: string;
};

type VissCoordinateInfoResponse = {
  NearbyWaters?: VissNearbyWater[];
};

type VissRiskSection = {
  SectionName?: string;
  Risk?: string;
};

type VissRiskClassification = {
  EU_CD?: string;
  MS_CD?: string;
  UUID?: string;
  Name?: string;
  WaterCategory?: string;
  RiskSections?: VissRiskSection[];
};

export type PublicIntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export type PublicIntegrationCard = {
  id: string;
  name: string;
  provider: string;
  dataType: string;
  status: PublicIntegrationStatus;
  lastSync: string;
  complexity: 1 | 2 | 3 | 4 | 5;
  reason: string;
  activation: ActivationClass;
  latencyMs?: number;
  endpoint?: string;
};

export type PublicDatasourceSummary = {
  cards: PublicIntegrationCard[];
  dispatch: ReturnType<typeof getDispatchProviderRuntimeStatus>;
  checkedAt: string;
};

type SluRuntimeSummary = {
  ready: boolean;
  reason: string;
  endpoint?: string;
};

export type PublicWaterAudit = {
  hits: Array<{
    external_id: string;
    name: string | null;
    water_type: string | null;
    status_ecological: string | null;
    status_chemical: string | null;
    distance: number;
  }>;
  hasWaterRisk: boolean;
  buffer_meters: number;
  source: 'local_postgis' | 'viss_open_api' | 'unavailable';
  sourceAvailable: boolean;
  manualReviewRequired: boolean;
  warning?: string;
};

export type PublicHeritageAudit = {
  hits: Array<{
    id: string;
    object_type: string;
    name: string;
    protection_class?: string | null;
    distance: number;
  }>;
  hasHeritageRisk: boolean;
  buffer_meters: number;
  source: 'local_postgis' | 'raa_live' | 'unavailable';
  sourceAvailable: boolean;
  manualReviewRequired: boolean;
  warning?: string;
};

export type PublicClimateAudit = {
  isFlooded: boolean | null;
  sourceAvailable: boolean;
  manualReviewRequired: boolean;
  source: 'local_postgis' | 'msb_live' | 'unavailable';
  hitCount: number;
  warning?: string;
};

const DEFAULT_FEATURE_LIMIT = 1000;
const HYDRO_BUFFER_METERS = 500;
const HERITAGE_BUFFER_METERS = 100;
const PUBLIC_SUMMARY_TTL_MS = 5 * 60_000;
const RAA_WFS_URL = 'https://pub.raa.se/visning/lamningar_v1/wfs';
const MSB_FLOOD_WFS_URL = 'https://inspire.msb.se/geoserver/oversvamning/wfs';
const VISS_API_BASE_URL = String(process.env.VISS_API_BASE_URL || 'https://viss.lansstyrelsen.se/api').trim();
const EXCLUDED_PUBLIC_SUMMARY_KEYS = new Set(['kommun_kontakter_csv', 'kommunala_diarier']);

type SguImportedLayerDefinition = {
  key: string;
  label: string;
  table: string;
};

const SGU_COASTAL_EROSION_TABLES: readonly SguImportedLayerDefinition[] = [
  { key: 'erosionsskydd', label: 'Erosionsskydd', table: 'sgu_coastal_erosion_erosionsskydd' },
  {
    key: 'erosionsforhallande_plus1m',
    label: 'Erosionsforhallande +1 m',
    table: 'sgu_coastal_erosion_erosionsforhallande_plus1m',
  },
  { key: 'dynfotsforandring', label: 'Dynfotsforandring', table: 'sgu_coastal_erosion_dynfotsforandring' },
  { key: 'strandmaterial', label: 'Strandmaterial', table: 'sgu_coastal_erosion_strandmaterial' },
  {
    key: 'sedimentsystem_grans',
    label: 'Sedimentsystemgrans',
    table: 'sgu_coastal_erosion_sedimentsystem_grans',
  },
  { key: 'stranddynamik', label: 'Stranddynamik', table: 'sgu_coastal_erosion_stranddynamik' },
  {
    key: 'sedimenttransport_kustparallell',
    label: 'Kustparallell sedimenttransport',
    table: 'sgu_coastal_erosion_sedimenttransport_kustparallell',
  },
  {
    key: 'erosionsforhallande_strand',
    label: 'Erosionsforhallande strand',
    table: 'sgu_coastal_erosion_erosionsforhallande_strand',
  },
  { key: 'oversvamningsskydd', label: 'Oversvamningsskydd', table: 'sgu_coastal_erosion_oversvamningsskydd' },
  { key: 'vattenyta_prognos', label: 'Vattenyta prognos', table: 'sgu_coastal_erosion_vattenyta_prognos' },
  { key: 'aktiv_erosion', label: 'Aktiv erosion', table: 'sgu_coastal_erosion_aktiv_erosion' },
  { key: 'bottenmaterial', label: 'Bottenmaterial', table: 'sgu_coastal_erosion_bottenmaterial' },
  { key: 'bottendynamik', label: 'Bottendynamik', table: 'sgu_coastal_erosion_bottendynamik' },
  { key: 'erosionsindex', label: 'Erosionsindex', table: 'sgu_coastal_erosion_erosionsindex' },
];

const SGU_HIGHEST_COASTLINE_TABLES: readonly SguImportedLayerDefinition[] = [
  { key: 'hk_punkt', label: 'Hogsta kustlinjen punkt', table: 'sgu_highest_coastline_hk_punkt' },
  { key: 'hk_yta', label: 'Hogsta kustlinjen yta', table: 'sgu_highest_coastline_hk_yta' },
];

let cachedSummary: { expiresAt: number; value: PublicDatasourceSummary } | null = null;

function getSguCoverageMode(): SguCoverageMode {
  return String(process.env.SGU_DB_COVERAGE_MODE || 'complete')
    .trim()
    .toLowerCase() === 'sample'
    ? 'sample'
    : 'complete';
}

function pointBbox(lat: number, lng: number, paddingDegrees: number): Bbox {
  return {
    minLng: lng - paddingDegrees,
    minLat: lat - paddingDegrees,
    maxLng: lng + paddingDegrees,
    maxLat: lat + paddingDegrees,
  };
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ regclass: string | null }>>`
    SELECT to_regclass(${`${schema}.${table}`})::text AS regclass
  `;
  return Boolean(rows[0]?.regclass);
}

function quotePgIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function localWaterBodyTableHasRows(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ has_rows: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM hydro.water_body LIMIT 1) AS has_rows
  `;
  return Boolean(rows[0]?.has_rows);
}

function safeParseGeometry(geojson: string): GeoJsonGeometry | null {
  try {
    return JSON.parse(geojson) as GeoJsonGeometry;
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseSwedishDecimal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function toFeatureCollection<T extends LocalNamedGeometryRow>(
  rows: T[],
  mapProperties: (row: T) => Record<string, unknown>,
  meta?: Record<string, unknown>,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows
      .map((row) => ({
        type: 'Feature' as const,
        geometry: safeParseGeometry(row.geojson),
        properties: mapProperties(row),
      }))
      .filter((feature) => feature.geometry),
    meta,
  };
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildVissUrl(
  method: string,
  extraParams: Record<string, string | number | boolean | undefined>,
): string {
  const apiKey = normalizeOptionalText(process.env.VISS_API_KEY);
  if (!apiKey) {
    throw new Error('VISS_API_KEY saknas.');
  }

  const params = new URLSearchParams({
    method,
    format: 'Json',
    apikey: apiKey,
  });

  for (const [key, value] of Object.entries(extraParams)) {
    if (value == null) continue;
    params.set(key, String(value));
  }

  return `${VISS_API_BASE_URL}?${params.toString()}`;
}

async function fetchVissCoordinateInfo(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<VissCoordinateInfoResponse> {
  // VISS expects WGS84 coordinates as x=lat and y=lng in its Open API.
  const url = buildVissUrl('coordinateinfo', {
    x: lat,
    y: lng,
    radius: Math.max(0, Math.round(radiusMeters)),
    coordinateformat: 'WGS84',
  });
  return fetchJsonWithTimeout<VissCoordinateInfoResponse>(url, 10_000);
}

async function fetchVissRiskClassification(waterPublicId: string): Promise<VissRiskClassification | null> {
  const url = buildVissUrl('waterriskclassifications', {
    waterpublicid: waterPublicId,
  });
  const payload = await fetchJsonWithTimeout<VissRiskClassification[] | { Data?: VissRiskClassification[] }>(
    url,
    12_000,
  );
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload.Data) ? payload.Data : [];

  if (rows.length === 0) return null;
  return (
    rows.find(
      (row) => row.EU_CD === waterPublicId || row.MS_CD === waterPublicId || row.UUID === waterPublicId,
    ) ||
    rows[0] ||
    null
  );
}

function extractVissRiskLabel(sections: VissRiskSection[] | undefined, matcher: RegExp): string | null {
  if (!Array.isArray(sections)) return null;
  const match = sections.find((section) => matcher.test(String(section.SectionName || '')));
  return normalizeOptionalText(match?.Risk);
}

async function runVissOpenApiWaterAudit(lat: number, lng: number): Promise<PublicWaterAudit> {
  const coordinateInfo = await fetchVissCoordinateInfo(lat, lng, HYDRO_BUFFER_METERS);
  const nearbyWaters = Array.isArray(coordinateInfo.NearbyWaters)
    ? coordinateInfo.NearbyWaters.slice(0, 5)
    : [];

  if (nearbyWaters.length === 0) {
    return {
      hits: [],
      hasWaterRisk: false,
      buffer_meters: HYDRO_BUFFER_METERS,
      source: 'viss_open_api',
      sourceAvailable: true,
      manualReviewRequired: true,
      warning:
        'VISS Open API svarade men hittade ingen vattenforekomst inom granskningsradien. Resultatet ska granskas manuellt.',
    };
  }

  const riskLookupErrors: string[] = [];
  const hits = await Promise.all(
    nearbyWaters.map(async (water) => {
      const externalId =
        normalizeOptionalText(water.EU_CD) ||
        normalizeOptionalText(water.MS_CD) ||
        normalizeOptionalText(water.UUID) ||
        crypto.randomUUID();
      const hitLat = parseSwedishDecimal(water.XCoordinate);
      const hitLng = parseSwedishDecimal(water.YCoordinate);
      let statusEcological: string | null = null;
      let statusChemical: string | null = null;

      try {
        const risk = await fetchVissRiskClassification(externalId);
        statusEcological = extractVissRiskLabel(risk?.RiskSections, /ekologisk status/i);
        statusChemical = extractVissRiskLabel(risk?.RiskSections, /kemisk status/i);
      } catch (error) {
        riskLookupErrors.push(error instanceof Error ? error.message : String(error));
      }

      return {
        external_id: externalId,
        name: normalizeOptionalText(water.Name) || normalizeOptionalText(water.SwedishName),
        water_type: normalizeOptionalText(water.WaterCategory),
        status_ecological: statusEcological,
        status_chemical: statusChemical,
        distance:
          hitLat != null && hitLng != null
            ? haversineDistanceMeters(lat, lng, hitLat, hitLng)
            : HYDRO_BUFFER_METERS,
      };
    }),
  );

  hits.sort((left, right) => left.distance - right.distance);

  const uniqueRiskErrors = [...new Set(riskLookupErrors)].slice(0, 2);
  const warningBase =
    'Lokal hydrologitabell saknas. VISS Open API livefallback anvands och ska granskas manuellt.';
  const warning =
    uniqueRiskErrors.length > 0
      ? `${warningBase} Riskklassning saknas delvis: ${uniqueRiskErrors.join(' | ')}`
      : warningBase;

  return {
    hits,
    hasWaterRisk: hits.length > 0,
    buffer_meters: HYDRO_BUFFER_METERS,
    source: 'viss_open_api',
    sourceAvailable: true,
    manualReviewRequired: true,
    warning,
  };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371e3;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function geometryReferencePoint(geometry: GeoJsonGeometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  const { type, coordinates } = geometry;
  if (type === 'Point' && Array.isArray(coordinates) && coordinates.length >= 2) {
    return [Number(coordinates[0]), Number(coordinates[1])];
  }
  if (type === 'LineString' && Array.isArray(coordinates) && coordinates.length > 0) {
    const point = coordinates[0] as number[];
    if (Array.isArray(point) && point.length >= 2) return [Number(point[0]), Number(point[1])];
  }
  if (type === 'Polygon' && Array.isArray(coordinates) && coordinates.length > 0) {
    const ring = coordinates[0] as number[][];
    if (Array.isArray(ring) && ring.length > 0 && ring[0].length >= 2) {
      return [Number(ring[0][0]), Number(ring[0][1])];
    }
  }
  if (type === 'MultiPolygon' && Array.isArray(coordinates) && coordinates.length > 0) {
    const polygon = coordinates[0] as number[][][];
    if (Array.isArray(polygon) && polygon.length > 0 && polygon[0].length > 0 && polygon[0][0].length >= 2) {
      return [Number(polygon[0][0][0]), Number(polygon[0][0][1])];
    }
  }
  if (type === 'MultiLineString' && Array.isArray(coordinates) && coordinates.length > 0) {
    const line = coordinates[0] as number[][];
    if (Array.isArray(line) && line.length > 0 && line[0].length >= 2) {
      return [Number(line[0][0]), Number(line[0][1])];
    }
  }
  return null;
}

export async function getProtectedAreaLayer(
  bbox: Bbox | null,
  limit: number = DEFAULT_FEATURE_LIMIT,
): Promise<FeatureCollection> {
  const hasProtectedArea = await tableExists('env', 'protected_area');
  const hasNatura2000Area = await tableExists('env', 'natura2000_area');
  if (!hasProtectedArea && !hasNatura2000Area) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Skyddade omraden kunde inte hamtas eftersom tabeller saknas i databasen.',
      },
    };
  }

  const maxRows = Math.max(1, Math.min(limit, DEFAULT_FEATURE_LIMIT));
  let rows: LocalNamedGeometryRow[] = [];
  if (hasProtectedArea && hasNatura2000Area) {
    rows = bbox
      ? await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT *
        FROM (
          SELECT
            pa.nvr_id,
            pa.name,
            pa.protection_type,
            'NVR'::text AS source,
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
          FROM env.protected_area pa
          WHERE pa.geom && ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
          AND ST_Intersects(
            pa.geom,
            ST_Transform(
              ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
              3006
            )
          )

          UNION ALL

          SELECT
            na.external_id AS nvr_id,
            na.site_name AS name,
            ('Natura 2000 ' || na.category) AS protection_type,
            'Natura2000'::text AS source,
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.wkb_geometry, 50), 4326)) AS geojson
          FROM env.natura2000_area na
          WHERE na.wkb_geometry && ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
          AND ST_Intersects(
            na.wkb_geometry,
            ST_Transform(
              ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
              3006
            )
          )
        ) protected_hits
        LIMIT ${maxRows};
      `
      : await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT *
        FROM (
          SELECT
            pa.nvr_id,
            pa.name,
            pa.protection_type,
            'NVR'::text AS source,
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
          FROM env.protected_area pa

          UNION ALL

          SELECT
            na.external_id AS nvr_id,
            na.site_name AS name,
            ('Natura 2000 ' || na.category) AS protection_type,
            'Natura2000'::text AS source,
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.wkb_geometry, 50), 4326)) AS geojson
          FROM env.natura2000_area na
        ) protected_hits
        LIMIT ${maxRows};
      `;
  } else if (hasProtectedArea) {
    rows = bbox
      ? await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          pa.nvr_id,
          pa.name,
          pa.protection_type,
          'NVR'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
        FROM env.protected_area pa
        WHERE pa.geom && ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
        AND ST_Intersects(
          pa.geom,
          ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
        )
        LIMIT ${maxRows};
      `
      : await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          pa.nvr_id,
          pa.name,
          pa.protection_type,
          'NVR'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
        FROM env.protected_area pa
        LIMIT ${maxRows};
      `;
  } else if (hasNatura2000Area) {
    rows = bbox
      ? await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          na.external_id AS nvr_id,
          na.site_name AS name,
          ('Natura 2000 ' || na.category) AS protection_type,
          'Natura2000'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.wkb_geometry, 50), 4326)) AS geojson
        FROM env.natura2000_area na
        WHERE na.wkb_geometry && ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
        AND ST_Intersects(
          na.wkb_geometry,
          ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
        )
        LIMIT ${maxRows};
      `
      : await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          na.external_id AS nvr_id,
          na.site_name AS name,
          ('Natura 2000 ' || na.category) AS protection_type,
          'Natura2000'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.wkb_geometry, 50), 4326)) AS geojson
        FROM env.natura2000_area na
        LIMIT ${maxRows};
      `;
  }

  return toFeatureCollection(
    rows,
    (row) => ({
      nvr_id: row.nvr_id,
      name: row.name,
      protection_type: row.protection_type,
      source: row.source,
    }),
    {
      source: 'local_postgis',
      available: true,
      manualReviewRequired: false,
      coverageMode: 'complete',
    },
  );
}

export async function getNatura2000Layer(
  bbox: Bbox | null,
  limit: number = DEFAULT_FEATURE_LIMIT,
): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'natura2000_area'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Natura 2000-tabellen saknas i databasen.',
      },
    };
  }

  const maxRows = Math.max(1, Math.min(limit, DEFAULT_FEATURE_LIMIT));
  const rows = bbox
    ? await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          na.external_id AS nvr_id,
          na.site_name AS name,
          ('Natura 2000 ' || na.category) AS protection_type,
          'Natura2000'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.wkb_geometry, 50), 4326)) AS geojson
        FROM env.natura2000_area na
        WHERE na.wkb_geometry && ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
        AND ST_Intersects(
          na.wkb_geometry,
          ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
        )
        LIMIT ${maxRows};
      `
    : await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          na.external_id AS nvr_id,
          na.site_name AS name,
          ('Natura 2000 ' || na.category) AS protection_type,
          'Natura2000'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.wkb_geometry, 50), 4326)) AS geojson
        FROM env.natura2000_area na
        LIMIT ${maxRows};
      `;

  return toFeatureCollection(
    rows,
    (row) => ({
      nvr_id: row.nvr_id,
      name: row.name,
      protection_type: row.protection_type,
      source: row.source,
    }),
    {
      source: 'local_postgis',
      available: true,
      manualReviewRequired: false,
      coverageMode: 'complete',
    },
  );
}

export async function getInternationalProtectionLayer(
  bbox: Bbox | null,
  limit: number = DEFAULT_FEATURE_LIMIT,
): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'protected_area'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Tabellen env.protected_area saknas i databasen.',
      },
    };
  }

  const maxRows = Math.max(1, Math.min(limit, DEFAULT_FEATURE_LIMIT));
  const rows = bbox
    ? await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          pa.nvr_id,
          pa.name,
          pa.protection_type,
          'NVR'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
        FROM env.protected_area pa
        WHERE pa.protection_type IN ('RAMSAR', 'Varldsarv', 'Biosfarsomraade', 'Nationalparksplan', 'Statlig skog')
          AND pa.geom && ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
          AND ST_Intersects(
            pa.geom,
            ST_Transform(
              ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
              3006
            )
          )
        LIMIT ${maxRows};
      `
    : await prisma.$queryRaw<LocalNamedGeometryRow[]>`
        SELECT
          pa.nvr_id,
          pa.name,
          pa.protection_type,
          'NVR'::text AS source,
          ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
        FROM env.protected_area pa
        WHERE pa.protection_type IN ('RAMSAR', 'Varldsarv', 'Biosfarsomraade', 'Nationalparksplan', 'Statlig skog')
        LIMIT ${maxRows};
      `;

  return toFeatureCollection(
    rows,
    (row) => ({
      nvr_id: row.nvr_id,
      name: row.name,
      protection_type: row.protection_type,
      source: row.source,
    }),
    {
      source: 'local_postgis',
      available: true,
      manualReviewRequired: false,
      coverageMode: 'complete',
    },
  );
}

export async function getWaterProtectionLayer(
  bbox: Bbox | null,
  limit: number = DEFAULT_FEATURE_LIMIT,
): Promise<FeatureCollection> {
  if (!bbox) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'bbox kravs for vattenskyddslager.',
      },
    };
  }

  const maxRows = Math.max(1, Math.min(limit, DEFAULT_FEATURE_LIMIT));
  if (await tableExists('env', 'water_protection_area')) {
    // Tabellens kolumner kommer från NVR-importen (nvrid/namn/tillsynsmh/...) — inte från
    // Inspire-mappningen (gml_id/text/characterstring/beginlifespanversion). Mappar därför
    // attributen till det interna kontraktet (id/name/authority/source_updated_at).
    const rows = await prisma.$queryRaw<LocalNamedGeometryRow[]>`
      SELECT
        COALESCE(wpa.nvrid, wpa.ogc_fid::text) AS id,
        COALESCE(wpa.namn, 'Vattenskyddsomrade') AS name,
        wpa.tillsynsmh AS authority,
        COALESCE(wpa.sengalldat::text, wpa.ursbesldat::text) AS source_updated_at,
        'water_protection_area'::text AS source,
        ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(wpa.wkb_geometry, 25), 4326)) AS geojson
      FROM env.water_protection_area wpa
      WHERE wpa.wkb_geometry && ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
      AND ST_Intersects(
        wpa.wkb_geometry,
        ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
      )
      LIMIT ${maxRows};
    `;

    return toFeatureCollection(
      rows,
      (row) => ({
        id: row.id,
        name: row.name,
        authority: row.authority,
        sourceUpdatedAt: row.source_updated_at,
        source: row.source,
      }),
      {
        source: 'local_postgis',
        available: true,
        manualReviewRequired: false,
        coverageMode: 'water_protection_area',
      },
    );
  }

  if (!(await tableExists('env', 'protected_area'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Vattenskydd kunde inte beraknas eftersom skyddsomradestabellen saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<LocalNamedGeometryRow[]>`
    SELECT
      pa.nvr_id,
      pa.name,
      pa.protection_type,
      'water_protection'::text AS source,
      ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pa.geom, 50), 4326)) AS geojson
    FROM env.protected_area pa
    WHERE pa.geom && ST_Transform(
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
      3006
    )
    AND ST_Intersects(
      pa.geom,
      ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
    )
    AND (
      LOWER(COALESCE(pa.protection_type, '')) LIKE '%vattenskydd%'
      OR LOWER(COALESCE(pa.protection_type, '')) LIKE '%grundvatten%'
      OR LOWER(COALESCE(pa.name, '')) LIKE '%vattenskydd%'
      OR LOWER(COALESCE(pa.name, '')) LIKE '%vattentakt%'
      OR LOWER(COALESCE(pa.name, '')) LIKE '%grundvatten%'
    )
    LIMIT ${maxRows};
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      nvr_id: row.nvr_id,
      name: row.name,
      protection_type: row.protection_type,
      source: row.source,
    }),
    {
      source: 'local_postgis',
      available: true,
      manualReviewRequired: false,
      coverageMode: 'filtered_protected_area',
    },
  );
}

export async function getSguWellLayer(bbox: Bbox, limit: number = 2000): Promise<FeatureCollection> {
  const maxRows = Math.max(1, Math.min(limit, 5000));
  if (!(await tableExists('env', 'sgu_well_actual'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Lokal SGU brunnstabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<SguWellLayerRow[]>`
    SELECT
      brunnsid::text AS brunnsid,
      fastighet,
      kommunnamn,
      anvandning,
      totaldjup,
      jorddjup,
      kapacitet,
      ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geojson
    FROM env.sgu_well_actual
    WHERE geom IS NOT NULL
      AND geom && ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
      AND ST_Intersects(
        geom,
        ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
      )
    LIMIT ${maxRows};
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      brunnsid: row.brunnsid,
      fastighet: row.fastighet,
      kommunnamn: row.kommunnamn,
      anvandning: row.anvandning,
      totaldjup: row.totaldjup,
      jorddjup: row.jorddjup,
      kapacitet: row.kapacitet,
      source: 'SGU Brunnar',
    }),
    {
      source: 'local_postgis',
      available: true,
      manualReviewRequired: true,
      featureLimit: maxRows,
    },
  );
}

export async function getSguGroundLayerLayer(bbox: Bbox): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'sgu_soil_type_25k_100k'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Lokal SGU jordartstabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRawUnsafe<GroundLayerRow[]>(
    `
      SELECT
        ogc_fid::text AS source_key,
        jg2 AS layer_code,
        jg2_tx AS layer_label,
        karttyp AS map_type,
        '1:25 000-1:100 000'::text AS source_scale,
        ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 100), 4326)) AS geojson
      FROM env.sgu_soil_type_25k_100k
      WHERE geom && ST_Transform(
        ST_MakeEnvelope($1, $2, $3, $4, 4326),
        3006
      )
      AND ST_Intersects(
        geom,
        ST_Transform(
          ST_MakeEnvelope($1, $2, $3, $4, 4326),
          3006
        )
      )
      LIMIT $5;
    `,
    bbox.minLng,
    bbox.minLat,
    bbox.maxLng,
    bbox.maxLat,
    DEFAULT_FEATURE_LIMIT,
  );

  return toFeatureCollection(
    rows,
    (row) => ({
      source_key: row.source_key,
      layer_code: row.layer_code,
      layer_label: row.layer_label,
      map_type: row.map_type,
      source_scale: row.source_scale,
    }),
    {
      coverageMode: getSguCoverageMode(),
      screeningOnly: true,
      manualReviewRequired: true,
      featureLimit: DEFAULT_FEATURE_LIMIT,
    },
  );
}

export async function getSguPermeabilityLayer(bbox: Bbox): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'sgu_permeability'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Lokal SGU genomslapplighetstabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<SguPermeabilityLayerRow[]>`
    SELECT
      objectid::text AS objectid,
      genomslapp AS permeability_code,
      genomslapp_tx AS permeability_label,
      jg2 AS soil_code,
      jg2_tx AS soil_label,
      kartering AS mapping_name,
      ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 25), 4326)) AS geojson
    FROM env.sgu_permeability
    WHERE geom && ST_Transform(
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
      3006
    )
    AND ST_Intersects(
      geom,
      ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
    )
    LIMIT 1500;
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      objectid: row.objectid,
      permeabilityCode: row.permeability_code,
      permeabilityLabel: row.permeability_label,
      soilCode: row.soil_code,
      soilLabel: row.soil_label,
      mappingName: row.mapping_name,
      source: 'SGU Genomslapplighet',
    }),
    {
      source: 'local_postgis',
      available: true,
      screeningOnly: true,
      manualReviewRequired: true,
      featureLimit: 1500,
    },
  );
}

export async function getSguGroundwaterMagazineLayer(bbox: Bbox): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'sgu_groundwater_magazine'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Lokal SGU grundvattenmagasinstabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<SguGroundwaterMagazineLayerRow[]>`
    SELECT
      COALESCE(magasinsidentitet::text, unik_magasinsidentitet) AS id,
      magasinsnamn AS name,
      akvifertyp AS aquifer_type,
      infiltrationsmojligheter AS infiltration,
      medelmaktighet_mattad_zon AS saturated_zone,
      medelmaktighet_omattad_zon AS unsaturated_zone,
      ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 25), 4326)) AS geojson
    FROM env.sgu_groundwater_magazine
    WHERE geom && ST_Transform(
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
      3006
    )
    AND ST_Intersects(
      geom,
      ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
    )
    LIMIT 1500;
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      id: row.id,
      name: row.name,
      aquiferType: row.aquifer_type,
      infiltration: row.infiltration,
      saturatedZone: row.saturated_zone,
      unsaturatedZone: row.unsaturated_zone,
      source: 'SGU Grundvattenmagasin',
    }),
    {
      source: 'local_postgis',
      available: true,
      screeningOnly: true,
      manualReviewRequired: true,
      featureLimit: 1500,
    },
  );
}

export async function getSguGroundwaterBodyLayer(bbox: Bbox): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'sgu_groundwater_body'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Lokal SGU grundvattenforekomsttabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<SguGroundwaterBodyLayerRow[]>`
    SELECT
      eu_cd,
      ms_cd,
      name,
      wb_type AS water_body_type,
      url_viss AS viss_url,
      ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 25), 4326)) AS geojson
    FROM env.sgu_groundwater_body
    WHERE geom && ST_Transform(
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
      3006
    )
    AND ST_Intersects(
      geom,
      ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
    )
    LIMIT 1500;
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      euCd: row.eu_cd,
      msCd: row.ms_cd,
      name: row.name,
      waterBodyType: row.water_body_type,
      vissUrl: row.viss_url,
      source: 'SGU Grundvattenforekomster',
    }),
    {
      source: 'local_postgis',
      available: true,
      screeningOnly: true,
      manualReviewRequired: true,
      featureLimit: 1500,
    },
  );
}

export async function getSguLandslideLayer(bbox: Bbox): Promise<FeatureCollection> {
  if (!(await tableExists('env', 'sgu_landslide_feature'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        screeningOnly: true,
        manualReviewRequired: true,
        warning: 'Lokal SGU jordskred/ravin-tabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<LandslideRow[]>`
    SELECT
      source_key,
      feature_code,
      feature_label,
      symbol,
      ST_AsGeoJSON(ST_Transform(ST_Simplify(geom, 25), 4326)) AS geojson
    FROM env.sgu_landslide_feature
    WHERE geom && ST_Transform(
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
      3006
    )
    AND ST_Intersects(
      geom,
      ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
    )
    LIMIT 1500;
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      source_key: row.source_key,
      feature_code: row.feature_code,
      feature_label: row.feature_label,
      symbol: row.symbol,
    }),
    {
      coverageMode: getSguCoverageMode(),
      screeningOnly: true,
      manualReviewRequired: true,
      reviewBufferMeters: SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
      featureLimit: 1500,
    },
  );
}

async function getSguImportedLayerGroup(
  bbox: Bbox,
  layers: readonly SguImportedLayerDefinition[],
  sourceLabel: string,
  missingWarning: string,
  limit: number,
): Promise<FeatureCollection> {
  const maxRows = Math.max(1, Math.min(limit, 3000));
  const availableLayers: SguImportedLayerDefinition[] = [];
  for (const layer of layers) {
    if (await tableExists('env', layer.table)) {
      availableLayers.push(layer);
    }
  }

  if (availableLayers.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: missingWarning,
      },
    };
  }

  const perLayerLimit = Math.max(25, Math.ceil(maxRows / availableLayers.length));
  const rowGroups = await Promise.all(
    availableLayers.map(async (layer) => {
      try {
        const rows = await prisma.$queryRawUnsafe<SguImportedLayerRow[]>(
          `
            SELECT
              $1::text AS layer_key,
              $2::text AS layer_label,
              ST_GeometryType(t.geom)::text AS geometry_type,
              (to_jsonb(t) - 'geom') AS raw_properties,
              ST_AsGeoJSON(
                ST_Transform(
                  CASE
                    WHEN ST_Dimension(t.geom) > 0 THEN ST_SimplifyPreserveTopology(t.geom, 25)
                    ELSE t.geom
                  END,
                  4326
                )
              ) AS geojson
            FROM env.${quotePgIdentifier(layer.table)} t
            WHERE t.geom IS NOT NULL
              AND t.geom && ST_Transform(ST_MakeEnvelope($3, $4, $5, $6, 4326), 3006)
              AND ST_Intersects(t.geom, ST_Transform(ST_MakeEnvelope($3, $4, $5, $6, 4326), 3006))
            LIMIT $7
          `,
          layer.key,
          layer.label,
          bbox.minLng,
          bbox.minLat,
          bbox.maxLng,
          bbox.maxLat,
          perLayerLimit,
        );
        return { layer, rows, error: null as string | null };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return { layer, rows: [] as SguImportedLayerRow[], error: message };
      }
    }),
  );

  const failedLayers = rowGroups.filter((group) => group.error);
  const rows = rowGroups.flatMap((group) => group.rows).slice(0, maxRows);
  const warning =
    failedLayers.length > 0
      ? `Vissa delager i ${sourceLabel} kunde inte lasas (${failedLayers
          .map((group) => group.layer.label)
          .join(', ')}).`
      : undefined;

  if (rows.length === 0 && failedLayers.length === availableLayers.length) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        screeningOnly: true,
        manualReviewRequired: true,
        featureLimit: maxRows,
        layerCount: layers.length,
        availableLayerCount: availableLayers.length,
        warning,
      },
    };
  }

  return toFeatureCollection(
    rows,
    (row) => ({
      layerKey: row.layer_key,
      layerLabel: row.layer_label,
      geometryType: row.geometry_type,
      rawProperties: row.raw_properties ?? {},
      source: sourceLabel,
    }),
    {
      source: 'local_postgis',
      available: true,
      screeningOnly: true,
      manualReviewRequired: true,
      featureLimit: maxRows,
      layerCount: layers.length,
      availableLayerCount: availableLayers.length,
      failedLayerCount: failedLayers.length,
      warning,
    },
  );
}

export async function getSguCoastalErosionLayer(
  bbox: Bbox,
  limit: number = 1500,
): Promise<FeatureCollection> {
  return getSguImportedLayerGroup(
    bbox,
    SGU_COASTAL_EROSION_TABLES,
    'SGU Stranderosion kust',
    'Lokala SGU-tabeller for stranderosion kust saknas.',
    limit,
  );
}

export async function getSguHighestCoastlineLayer(
  bbox: Bbox,
  limit: number = 1000,
): Promise<FeatureCollection> {
  return getSguImportedLayerGroup(
    bbox,
    SGU_HIGHEST_COASTLINE_TABLES,
    'SGU Hogsta kustlinjen',
    'Lokala SGU-tabeller for hogsta kustlinjen saknas.',
    limit,
  );
}

export async function getHydroLayer(
  kind: 'lakes' | 'streams',
  bbox: Bbox | null,
): Promise<FeatureCollection> {
  if (!bbox) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'bbox kravs for hydrolager.',
      },
    };
  }

  const tableName = kind === 'lakes' ? 'lake' : 'stream';
  const localTableExists = await tableExists('hydro', tableName);

  if (localTableExists) {
    const rows =
      kind === 'lakes'
        ? await prisma.$queryRaw<LocalNamedGeometryRow[]>`
          SELECT
            objid,
            namn,
            kategori,
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 50), 4326)) AS geojson
          FROM hydro.lake
          WHERE geom && ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
          AND ST_Intersects(
            geom,
            ST_Transform(
              ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
              3006
            )
          )
          LIMIT 1500;
        `
        : await prisma.$queryRaw<LocalNamedGeometryRow[]>`
          SELECT
            objid,
            namn,
            kategori,
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 50), 4326)) AS geojson
          FROM hydro.stream
          WHERE geom && ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
          AND ST_Intersects(
            geom,
            ST_Transform(
              ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
              3006
            )
          )
          LIMIT 2500;
        `;

    return toFeatureCollection(
      rows,
      (row) => ({
        objid: row.objid,
        namn: row.namn,
        kategori: row.kategori,
        source: 'local_postgis',
      }),
      {
        source: 'local_postgis',
        available: true,
        manualReviewRequired: false,
      },
    );
  }

  return {
    type: 'FeatureCollection',
    features: [],
    meta: {
      source: 'unavailable',
      available: false,
      manualReviewRequired: true,
      warning:
        kind === 'lakes'
          ? 'Lokal hydrotabell for sjoar saknas. Officiell VISS API kravs for extern vattenfallback och anvands inte anonymt.'
          : 'Lokal hydrotabell for vattendrag saknas. Officiell VISS API kravs for extern vattenfallback och anvands inte anonymt.',
    },
  };
}

export async function getWaterCatchmentLayer(bbox: Bbox): Promise<FeatureCollection> {
  if (!(await tableExists('hydro', 'water_catchment'))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'Lokal SVAR2022-avrinningsomradestabell saknas.',
      },
    };
  }

  const rows = await prisma.$queryRaw<WaterCatchmentLayerRow[]>`
    SELECT
      varoid,
      ms_cd,
      name,
      category,
      area,
      ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 50), 4326)) AS geojson
    FROM hydro.water_catchment
    WHERE geom && ST_Transform(
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
      3006
    )
    AND ST_Intersects(
      geom,
      ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
    )
    LIMIT 1500;
  `;

  return toFeatureCollection(
    rows,
    (row) => ({
      varoid: row.varoid,
      msCd: row.ms_cd,
      name: row.name,
      category: row.category,
      area: row.area,
      source: 'SVAR2022',
    }),
    {
      source: 'local_postgis',
      available: true,
      manualReviewRequired: true,
      featureLimit: 1500,
    },
  );
}

export async function getFloodRiskLayer(bbox: Bbox | null): Promise<FeatureCollection> {
  if (!bbox) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'bbox kravs for oversvamningslager.',
      },
    };
  }

  if (await tableExists('climate', 'flood_risk_area')) {
    // ogr2ogr-importen lämnade kvar geometry-kolumnen som `_ogr_geometry_` och saknar
    // explicita `source`/`return_period`-kolumner; vi mappar därför `likelihood` →
    // `return_period` och hard-codar källan till MSB.
    const rows = await prisma.$queryRaw<ClimateFloodGeometryRow[]>`
      SELECT
        external_id,
        'MSB'::text AS source,
        COALESCE(likelihood, typeofhaza, 'unknown')::text AS return_period,
        ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(_ogr_geometry_, 50), 4326)) AS geojson
      FROM climate.flood_risk_area
      WHERE _ogr_geometry_ && ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
      AND ST_Intersects(
        _ogr_geometry_,
        ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
      )
      LIMIT 1500;
    `;

    return toFeatureCollection(
      rows,
      (row) => ({
        external_id: row.external_id,
        source: row.source || 'MSB',
        return_period: row.return_period,
      }),
      {
        source: 'local_postgis',
        available: true,
        manualReviewRequired: false,
      },
    );
  }

  try {
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'oversvamning:NZ_Oversvamning_100',
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      count: '500',
      bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat},EPSG:4326`,
    });

    const data = await fetchJsonWithTimeout<{
      features?: Array<{
        geometry?: GeoJsonGeometry | null;
        properties?: Record<string, unknown>;
      }>;
    }>(`${MSB_FLOOD_WFS_URL}?${params.toString()}`, 8000);

    return {
      type: 'FeatureCollection',
      features: (Array.isArray(data.features) ? data.features : [])
        .map((feature) => ({
          type: 'Feature' as const,
          geometry:
            feature?.geometry && typeof feature.geometry === 'object'
              ? (feature.geometry as GeoJsonGeometry)
              : null,
          properties: {
            ...(feature?.properties || {}),
            source: 'MSB live',
          },
        }))
        .filter((feature) => feature.geometry),
      meta: {
        source: 'msb_live',
        available: true,
        manualReviewRequired: true,
        warning: 'MSB liveoverlay ar indikativ och ska granskas manuellt innan slutsats.',
      },
    };
  } catch (error) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: `MSB oversvamningslager misslyckades: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

export async function runWaterAudit(lat: number, lng: number): Promise<PublicWaterAudit> {
  if (await tableExists('hydro', 'water_body')) {
    if (await localWaterBodyTableHasRows()) {
      const hits = await prisma.$queryRaw<WaterBodyRow[]>`
        SELECT
          external_id,
          name,
          water_type,
          status_ecological,
          status_chemical,
          ST_Distance(
            geom,
            ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
          ) AS distance_meters
        FROM hydro.water_body
        WHERE ST_DWithin(
          geom,
          ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006),
          ${HYDRO_BUFFER_METERS}
        )
        ORDER BY distance_meters ASC
        LIMIT 5;
      `;

      return {
        hits: hits.map((hit) => ({
          external_id: hit.external_id,
          name: hit.name,
          water_type: hit.water_type,
          status_ecological: hit.status_ecological,
          status_chemical: hit.status_chemical,
          distance: Math.round(Number(hit.distance_meters)),
        })),
        hasWaterRisk: hits.length > 0,
        buffer_meters: HYDRO_BUFFER_METERS,
        source: 'local_postgis',
        sourceAvailable: true,
        manualReviewRequired: false,
      };
    }
  }

  if (normalizeOptionalText(process.env.VISS_API_KEY)) {
    try {
      return await runVissOpenApiWaterAudit(lat, lng);
    } catch (error) {
      return {
        hits: [],
        hasWaterRisk: false,
        buffer_meters: HYDRO_BUFFER_METERS,
        source: 'unavailable',
        sourceAvailable: false,
        manualReviewRequired: true,
        warning: `VISS Open API misslyckades: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    hits: [],
    hasWaterRisk: false,
    buffer_meters: HYDRO_BUFFER_METERS,
    source: 'unavailable',
    sourceAvailable: false,
    manualReviewRequired: true,
    warning: 'Lokal hydrologitabell saknas och VISS_API_KEY ar inte konfigurerad for extern vattenkontroll.',
  };
}

async function fetchRaaFeatures(layerName: string, bbox: Bbox, count: number = 100): Promise<RaaFeature[]> {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layerName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(count),
    bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat},EPSG:4326`,
  });
  const data = await fetchJsonWithTimeout<{ features?: RaaFeature[] }>(`${RAA_WFS_URL}?${params.toString()}`);
  return Array.isArray(data.features) ? data.features : [];
}

const RAA_FORNLAMNING_WFS_LAYERS = [
  'lamningar_v1:fornlamning',
  'lamningar_v1:mojligfornlamning',
  'lamningar_v1:ovrkulthistlamning',
] as const;

export type HeritageViewportBbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

/**
 * WFS Fornsök-lager sammanslagna till en GeoJSON FeatureCollection (nedladdning / karta).
 * Kompletterar K-samsök-index (objekt-URI:er) enligt RAA:s dokumentation.
 */
export async function getRaaFornlamningFeatureCollectionForBbox(
  bbox: HeritageViewportBbox,
  limitPerLayer: number = 500,
): Promise<FeatureCollection> {
  const b: Bbox = { ...bbox };
  const groups = await Promise.all(
    RAA_FORNLAMNING_WFS_LAYERS.map((layer) => fetchRaaFeatures(layer, b, limitPerLayer)),
  );

  const features: FeatureCollection['features'] = [];
  for (let li = 0; li < RAA_FORNLAMNING_WFS_LAYERS.length; li++) {
    const typeName = RAA_FORNLAMNING_WFS_LAYERS[li];
    for (const feature of groups[li]) {
      features.push({
        type: 'Feature',
        geometry: feature.geometry ?? null,
        properties: {
          ...(feature.properties && typeof feature.properties === 'object' ? feature.properties : {}),
          _raaWfsTypeName: typeName,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
    meta: {
      source: 'raa_wfs_pub',
      layers: [...RAA_FORNLAMNING_WFS_LAYERS],
      wfsBaseUrl: RAA_WFS_URL,
    },
  };
}

function mapRaaFeatureToAudit(feature: RaaFeature, lat: number, lng: number) {
  const point = geometryReferencePoint(feature.geometry);
  if (!point) return null;
  const [hitLng, hitLat] = point;
  return {
    id: String(
      feature.id ||
        feature.properties?.lamningsnummer ||
        feature.properties?.raa_nummer ||
        feature.properties?.id ||
        crypto.randomUUID(),
    ),
    object_type: String(feature.properties?.lamningstyp || feature.properties?.objekttyp || 'Okand lamning'),
    name: String(feature.properties?.namn || feature.properties?.raa_nummer || 'Namn saknas'),
    protection_class: feature.properties?.antikvarisk_bedomning
      ? String(feature.properties.antikvarisk_bedomning)
      : null,
    distance: haversineDistanceMeters(lat, lng, hitLat, hitLng),
  };
}

export async function runHeritageAudit(lat: number, lng: number): Promise<PublicHeritageAudit> {
  if (await tableExists('culture', 'heritage_object')) {
    const hits = await prisma.$queryRaw<HeritageRow[]>`
      SELECT
        external_id,
        object_type,
        name,
        protection_class,
        ST_Distance(
          geom,
          ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
        ) AS distance_meters
      FROM culture.heritage_object
      WHERE ST_DWithin(
        geom,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006),
        ${HERITAGE_BUFFER_METERS}
      )
      ORDER BY distance_meters ASC
      LIMIT 5;
    `;

    return {
      hits: hits.map((hit) => ({
        id: hit.external_id,
        object_type: hit.object_type || 'Okand lamning',
        name: hit.name || 'Namn saknas',
        protection_class: hit.protection_class,
        distance: Math.round(Number(hit.distance_meters)),
      })),
      hasHeritageRisk: hits.length > 0,
      buffer_meters: HERITAGE_BUFFER_METERS,
      source: 'local_postgis',
      sourceAvailable: true,
      manualReviewRequired: false,
    };
  }

  try {
    const bbox = pointBbox(lat, lng, 0.01);
    const featureGroups = await Promise.all([
      fetchRaaFeatures('lamningar_v1:fornlamning', bbox, 100),
      fetchRaaFeatures('lamningar_v1:mojligfornlamning', bbox, 100),
      fetchRaaFeatures('lamningar_v1:ovrkulthistlamning', bbox, 100),
    ]);
    const hits = featureGroups
      .flat()
      .map((feature) => mapRaaFeatureToAudit(feature, lat, lng))
      .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit))
      .filter((hit) => hit.distance <= HERITAGE_BUFFER_METERS)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 5);

    return {
      hits,
      hasHeritageRisk: hits.length > 0,
      buffer_meters: HERITAGE_BUFFER_METERS,
      source: 'raa_live',
      sourceAvailable: true,
      manualReviewRequired: true,
      warning: 'Lokal kulturtabell saknas. RAA livefallback anvands och ska granskas manuellt.',
    };
  } catch (error) {
    return {
      hits: [],
      hasHeritageRisk: false,
      buffer_meters: HERITAGE_BUFFER_METERS,
      source: 'unavailable',
      sourceAvailable: false,
      manualReviewRequired: true,
      warning: `RAA livekontroll misslyckades: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runClimateAudit(lat: number, lng: number): Promise<PublicClimateAudit> {
  if (await tableExists('climate', 'flood_risk_area')) {
    const hits = await prisma.$queryRaw<ClimateFloodRow[]>`
      SELECT
        external_id,
        source,
        return_period
      FROM climate.flood_risk_area
      WHERE ST_Intersects(
        geom,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      )
      LIMIT 50;
    `;

    const returnPeriods = [
      ...new Set(hits.map((hit) => hit.return_period).filter((value): value is string => Boolean(value))),
    ];
    return {
      isFlooded: hits.length > 0,
      sourceAvailable: true,
      manualReviewRequired: false,
      source: 'local_postgis',
      hitCount: hits.length,
      warning:
        hits.length > 0
          ? `Lokal oversvamningsdatabas markerar traff. ${returnPeriods.length > 0 ? `Returperiod: ${returnPeriods.join(', ')}.` : 'Returperiod saknas i lokalt urval.'}`
          : undefined,
    };
  }

  try {
    const bbox = pointBbox(lat, lng, 0.01);
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'oversvamning:NZ_Oversvamning_100',
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      count: '50',
      bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat},EPSG:4326`,
    });
    const data = await fetchJsonWithTimeout<{ features?: Array<unknown> }>(
      `${MSB_FLOOD_WFS_URL}?${params.toString()}`,
      5000,
    );
    const hitCount = Array.isArray(data.features) ? data.features.length : 0;
    return {
      isFlooded: hitCount > 0,
      sourceAvailable: true,
      manualReviewRequired: true,
      source: 'msb_live',
      hitCount,
      warning: 'MSB livekontroll ar indikativ och maste granskas manuellt innan slutsats.',
    };
  } catch (error) {
    return {
      isFlooded: null,
      sourceAvailable: false,
      manualReviewRequired: true,
      source: 'unavailable',
      hitCount: 0,
      warning: `MSB livekontroll misslyckades: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function providerLabel(name: string, implementationKey?: string): string {
  if (implementationKey === 'bankid') return 'BankID';
  if (implementationKey === 'slu') return 'SLU';
  if (implementationKey?.startsWith('lantmateriet')) return 'Lantmateriet';
  return name;
}

function resolveSourceDataType(
  implementationKey?: string,
  activation: ActivationClass = 'IMMEDIATE',
): string {
  if (implementationKey === 'smhi') return 'Vader och hydrologi';
  if (implementationKey === 'scb') return 'Statistik API';
  if (implementationKey === 'sgu') return 'Geodata och OGC';
  if (implementationKey === 'lansstyrelsen') return 'Regional geodata';
  if (implementationKey === 'riksantikvarieambetet') return 'Kulturmiljo';
  if (implementationKey === 'naturvardsverket') return 'Skyddad natur';
  if (implementationKey?.startsWith('lantmateriet')) return 'Fastighets- och geodata';
  if (implementationKey === 'msb') return 'Risklager';
  if (implementationKey === 'slu') return 'Artdata';
  if (implementationKey === 'kommun_kontakter_csv') return 'Lokal CSV';
  if (implementationKey === 'kommunala_diarier') return 'Diarieindex';
  if (implementationKey === 'smp') return 'Portal';
  if (implementationKey === 'trafikverket') return 'Transportdata';
  if (implementationKey === 'bankid') return 'E-legitimering';
  return activation === 'PERMIT_REQUIRED' ? 'Avtalsstyrd integration' : 'Oppna datakallor';
}

function integrationComplexity(activation: ActivationClass, key?: string): 1 | 2 | 3 | 4 | 5 {
  if (activation === 'PERMIT_REQUIRED') return 4;
  if (key === 'smhi' || key === 'msb') return 5;
  if (key === 'sgu' || key === 'slu' || key === 'lansstyrelsen' || key === 'riksantikvarieambetet') return 4;
  if (key === 'scb' || key === 'kommun_kontakter_csv' || key === 'kommunala_diarier') return 2;
  return 3;
}

function formatLastSync(latencyMs?: number, status?: number): string {
  if (typeof latencyMs === 'number' && typeof status === 'number') {
    return `${status} / ${latencyMs} ms`;
  }
  if (typeof latencyMs === 'number') {
    return `${latencyMs} ms`;
  }
  return 'Ej testad';
}

function hasBankIdConfig(): boolean {
  const hasPfx = Boolean(String(process.env.BANKID_PFX_PATH || '').trim());
  const hasPemPair = Boolean(
    String(process.env.BANKID_CERT_PATH || '').trim() && String(process.env.BANKID_KEY_PATH || '').trim(),
  );
  return Boolean(String(process.env.BANKID_BASE_URL || '').trim()) && (hasPfx || hasPemPair);
}

function hasLicensedLantmaterietConfig(): boolean {
  const hasOauthPair = Boolean(
    String(process.env.LANTMATERIET_CONSUMER_KEY || '').trim() &&
    String(process.env.LANTMATERIET_CONSUMER_SECRET || '').trim(),
  );
  const hasApiKey = Boolean(String(process.env.LANTMATERIET_API_KEY || '').trim());
  return hasOauthPair || hasApiKey;
}

async function getSluRuntimeSummary(): Promise<SluRuntimeSummary> {
  const productStatus = getSluProductStatus();
  const missingConfig = productStatus.filter((product) => !product.hasApiKey || !product.hasBasePath);
  if (missingConfig.length > 0) {
    return {
      ready: false,
      reason: 'SLU saknar API-nyckel eller base-path.',
    };
  }

  const products = productStatus.map((product) => product.product);
  const pingResults = await Promise.allSettled(products.map((product) => pingSluProduct(product)));
  const failingProducts = pingResults
    .map((result, index) => {
      if (result.status === 'fulfilled' && result.value.ok) return null;
      const product = products[index];
      if (result.status === 'fulfilled') {
        return `${product} (${result.value.status})`;
      }
      return `${product} (${result.reason instanceof Error ? result.reason.message : 'ping failed'})`;
    })
    .filter((value): value is string => Boolean(value));

  if (failingProducts.length > 0) {
    return {
      ready: false,
      reason: `SLU svarar inte korrekt for: ${failingProducts.join(', ')}.`,
    };
  }

  const firstEndpoint = pingResults.find((result) => result.status === 'fulfilled' && result.value.ok);
  return {
    ready: true,
    reason: 'SLU produkter ar konfigurerade och svarar live.',
    endpoint:
      firstEndpoint && firstEndpoint.status === 'fulfilled' ? firstEndpoint.value.endpoint : undefined,
  };
}

function buildCardFromCatalog(
  source: (typeof SOURCE_CATALOG)[number],
  openResult?: OpenSyncResult,
  sluRuntime?: SluRuntimeSummary,
): PublicIntegrationCard {
  let status: PublicIntegrationStatus =
    source.activation === 'PERMIT_REQUIRED' ? 'DISCONNECTED' : 'CONNECTED';
  let reason = source.reason;
  let endpoint = openResult?.endpoint;
  let latencyMs: number | undefined;
  let statusCode: number | undefined;

  if (source.implementationKey === 'bankid') {
    status = hasBankIdConfig() ? 'CONNECTED' : 'DISCONNECTED';
    reason = hasBankIdConfig()
      ? 'BankID mTLS och base-url ar konfigurerade.'
      : 'BankID saknar certifikat eller base-url.';
  } else if (source.implementationKey === 'lantmateriet_licensed') {
    status = hasLicensedLantmaterietConfig() ? 'CONNECTED' : 'DISCONNECTED';
    reason = hasLicensedLantmaterietConfig()
      ? 'Licensierad Lantmateriet-konfiguration finns i miljo.'
      : 'Licensierad Lantmateriet-konfiguration saknas.';
  } else if (source.implementationKey === 'slu') {
    const sluReady = sluRuntime?.ready ?? false;
    status = sluReady ? 'CONNECTED' : 'DISCONNECTED';
    reason = sluRuntime?.reason || 'SLU saknar API-nyckel eller base-path.';
    endpoint = sluRuntime?.endpoint;
  }

  if (openResult) {
    const permitGatedRuntime = source.activation === 'PERMIT_REQUIRED' && !openResult.ok;
    status = permitGatedRuntime ? 'DISCONNECTED' : openResult.ok ? 'CONNECTED' : 'ERROR';
    reason = openResult.ok
      ? `Livecheck OK (${openResult.status || 'n/a'})`
      : permitGatedRuntime
        ? source.reason
        : openResult.details || `Livecheck failed (${openResult.status || 'n/a'})`;
    statusCode = openResult.status;
    latencyMs = undefined;
  }

  return {
    id: source.implementationKey || source.name.toLowerCase().replace(/\s+/g, '-'),
    name: source.name,
    provider: providerLabel(source.name, source.implementationKey),
    dataType: resolveSourceDataType(source.implementationKey, source.activation),
    status,
    lastSync: formatLastSync(latencyMs, statusCode),
    complexity: integrationComplexity(source.activation, source.implementationKey),
    reason,
    activation: source.activation,
    latencyMs,
    endpoint,
  };
}

export async function getPublicDatasourceSummary(
  forceRefresh: boolean = false,
): Promise<PublicDatasourceSummary> {
  if (!forceRefresh && cachedSummary && cachedSummary.expiresAt > Date.now()) {
    return cachedSummary.value;
  }

  const openResults = await fetchImmediateOpenSources();
  const openByKey = new Map<string, OpenSyncResult>();
  for (const result of openResults) {
    openByKey.set(result.source, result);
  }
  const sluRuntime = await getSluRuntimeSummary();

  const cards = SOURCE_CATALOG.filter(
    (source) => !EXCLUDED_PUBLIC_SUMMARY_KEYS.has(String(source.implementationKey || '')),
  ).map((source) =>
    buildCardFromCatalog(
      source,
      source.implementationKey ? openByKey.get(source.implementationKey) : undefined,
      source.implementationKey === 'slu' ? sluRuntime : undefined,
    ),
  );

  const summary: PublicDatasourceSummary = {
    cards,
    dispatch: getDispatchProviderRuntimeStatus(),
    checkedAt: new Date().toISOString(),
  };

  cachedSummary = {
    expiresAt: Date.now() + PUBLIC_SUMMARY_TTL_MS,
    value: summary,
  };

  return summary;
}
function resolveTopo10TableName(layerName: string): string {
  const normalized = String(layerName || '')
    .trim()
    .toLowerCase();

  const aliases: Record<string, string> = {
    byggnad: 'byggnad',
    buildings: 'byggnad',
    building: 'byggnad',
    mark: 'mark',
    vag: 'vag',
    road: 'vag',
    roads: 'vag',
    vatten: 'vatten',
    water: 'vatten',
    jarnvag: 'jarnvag',
    railway: 'jarnvag',
    railways: 'jarnvag',
    anlaggning: 'anlaggning',
    installation: 'anlaggning',
    installations: 'anlaggning',
  };

  const resolved = aliases[normalized];
  if (!resolved) {
    throw new Error('Invalid topo10 table name');
  }

  return resolved;
}

// Tables in SRID 3006; all others are 4326
const TOPO10_SRID_3006 = new Set(['byggnad', 'jarnvag']);

export async function getTopo10Layer(bbox: Bbox, tableName: string = 'byggnad'): Promise<FeatureCollection> {
  const { minLng, minLat, maxLng, maxLat } = bbox;
  const resolvedTableName = resolveTopo10TableName(tableName);
  const fullTableName = `topo10.${resolvedTableName}`;
  const is3006 = TOPO10_SRID_3006.has(resolvedTableName);

  // We use a raw query because the table name is dynamic.
  // WHERE clause must match the table's native SRID to avoid SRID mismatch errors.
  const rows = (await prisma.$queryRawUnsafe(
    is3006
      ? `
    SELECT
      objektidentitet as id,
      objekttyp as category,
      ST_AsGeoJSON(ST_Transform(geom, 4326)) as geojson
    FROM ${fullTableName}
    WHERE geom && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006)
    LIMIT 2000
  `
      : `
    SELECT
      objektidentitet as id,
      objekttyp as category,
      ST_AsGeoJSON(geom) as geojson
    FROM ${fullTableName}
    WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
    LIMIT 2000
  `,
    minLng,
    minLat,
    maxLng,
    maxLat,
  )) as Array<{ id: string; category: string; geojson: string }>;

  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: JSON.parse(r.geojson),
      properties: {
        id: r.id,
        category: r.category,
      },
    })),
  };
}
