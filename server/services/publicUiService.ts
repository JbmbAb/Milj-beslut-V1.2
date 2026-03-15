import crypto from "node:crypto";
import { SOURCE_CATALOG, type ActivationClass } from "../datasources/catalog";
import { prisma } from "../db/prisma";
import { fetchImmediateOpenSources } from "./openDataSourceService";
import { SGU_LANDSLIDE_REVIEW_BUFFER_METERS, type SguCoverageMode } from "./sguRiskService";
import { getDispatchProviderRuntimeStatus } from "./transportDispatchService";
import { getSluProductStatus, pingSluProduct } from "./sluService";

type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
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

export type PublicIntegrationStatus = "CONNECTED" | "DISCONNECTED" | "ERROR";

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
  source: "local_postgis" | "viss_open_api" | "unavailable";
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
  source: "local_postgis" | "raa_live" | "unavailable";
  sourceAvailable: boolean;
  manualReviewRequired: boolean;
  warning?: string;
};

export type PublicClimateAudit = {
  isFlooded: boolean | null;
  sourceAvailable: boolean;
  manualReviewRequired: boolean;
  source: "local_postgis" | "msb_live" | "unavailable";
  hitCount: number;
  warning?: string;
};

const DEFAULT_FEATURE_LIMIT = 1000;
const HYDRO_BUFFER_METERS = 500;
const HERITAGE_BUFFER_METERS = 100;
const PUBLIC_SUMMARY_TTL_MS = 5 * 60_000;
const RAA_WFS_URL = "https://pub.raa.se/visning/lamningar_v1/wfs";
const MSB_FLOOD_WFS_URL = "https://inspire.msb.se/geoserver/oversvamning/wfs";
const VISS_API_BASE_URL = String(process.env.VISS_API_BASE_URL || "https://viss.lansstyrelsen.se/api").trim();
const EXCLUDED_PUBLIC_SUMMARY_KEYS = new Set(["kommun_kontakter_csv", "kommunala_diarier"]);

let cachedSummary: { expiresAt: number; value: PublicDatasourceSummary } | null = null;

function getSguCoverageMode(): SguCoverageMode {
  return String(process.env.SGU_DB_COVERAGE_MODE || "sample").trim().toLowerCase() === "complete"
    ? "complete"
    : "sample";
}

export function parseBbox(raw: string | null): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
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
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseSwedishDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toFeatureCollection<T extends LocalNamedGeometryRow>(
  rows: T[],
  mapProperties: (row: T) => Record<string, unknown>,
  meta?: Record<string, unknown>,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows
      .map((row) => ({
        type: "Feature" as const,
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

function buildVissUrl(method: string, extraParams: Record<string, string | number | boolean | undefined>): string {
  const apiKey = normalizeOptionalText(process.env.VISS_API_KEY);
  if (!apiKey) {
    throw new Error("VISS_API_KEY saknas.");
  }

  const params = new URLSearchParams({
    method,
    format: "Json",
    apikey: apiKey,
  });

  for (const [key, value] of Object.entries(extraParams)) {
    if (value == null) continue;
    params.set(key, String(value));
  }

  return `${VISS_API_BASE_URL}?${params.toString()}`;
}

async function fetchVissCoordinateInfo(lat: number, lng: number, radiusMeters: number): Promise<VissCoordinateInfoResponse> {
  // VISS expects WGS84 coordinates as x=lat and y=lng in its Open API.
  const url = buildVissUrl("coordinateinfo", {
    x: lat,
    y: lng,
    radius: Math.max(0, Math.round(radiusMeters)),
    coordinateformat: "WGS84",
  });
  return fetchJsonWithTimeout<VissCoordinateInfoResponse>(url, 10_000);
}

async function fetchVissRiskClassification(waterPublicId: string): Promise<VissRiskClassification | null> {
  const url = buildVissUrl("waterriskclassifications", {
    waterpublicid: waterPublicId,
  });
  const payload = await fetchJsonWithTimeout<VissRiskClassification[] | { Data?: VissRiskClassification[] }>(url, 12_000);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.Data)
      ? payload.Data
      : [];

  if (rows.length === 0) return null;
  return (
    rows.find((row) => row.EU_CD === waterPublicId || row.MS_CD === waterPublicId || row.UUID === waterPublicId) ||
    rows[0] ||
    null
  );
}

function extractVissRiskLabel(
  sections: VissRiskSection[] | undefined,
  matcher: RegExp,
): string | null {
  if (!Array.isArray(sections)) return null;
  const match = sections.find((section) => matcher.test(String(section.SectionName || "")));
  return normalizeOptionalText(match?.Risk);
}

async function runVissOpenApiWaterAudit(lat: number, lng: number): Promise<PublicWaterAudit> {
  const coordinateInfo = await fetchVissCoordinateInfo(lat, lng, HYDRO_BUFFER_METERS);
  const nearbyWaters = Array.isArray(coordinateInfo.NearbyWaters) ? coordinateInfo.NearbyWaters.slice(0, 5) : [];

  if (nearbyWaters.length === 0) {
    return {
      hits: [],
      hasWaterRisk: false,
      buffer_meters: HYDRO_BUFFER_METERS,
      source: "viss_open_api",
      sourceAvailable: true,
      manualReviewRequired: true,
      warning:
        "VISS Open API svarade men hittade ingen vattenforekomst inom granskningsradien. Resultatet ska granskas manuellt.",
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
  const warningBase = "Lokal hydrologitabell saknas. VISS Open API livefallback anvands och ska granskas manuellt.";
  const warning =
    uniqueRiskErrors.length > 0
      ? `${warningBase} Riskklassning saknas delvis: ${uniqueRiskErrors.join(" | ")}`
      : warningBase;

  return {
    hits,
    hasWaterRisk: hits.length > 0,
    buffer_meters: HYDRO_BUFFER_METERS,
    source: "viss_open_api",
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
  if (type === "Point" && Array.isArray(coordinates) && coordinates.length >= 2) {
    return [Number(coordinates[0]), Number(coordinates[1])];
  }
  if (type === "LineString" && Array.isArray(coordinates) && coordinates.length > 0) {
    const point = coordinates[0] as number[];
    if (Array.isArray(point) && point.length >= 2) return [Number(point[0]), Number(point[1])];
  }
  if (type === "Polygon" && Array.isArray(coordinates) && coordinates.length > 0) {
    const ring = coordinates[0] as number[][];
    if (Array.isArray(ring) && ring.length > 0 && ring[0].length >= 2) {
      return [Number(ring[0][0]), Number(ring[0][1])];
    }
  }
  if (type === "MultiPolygon" && Array.isArray(coordinates) && coordinates.length > 0) {
    const polygon = coordinates[0] as number[][][];
    if (Array.isArray(polygon) && polygon.length > 0 && polygon[0].length > 0 && polygon[0][0].length >= 2) {
      return [Number(polygon[0][0][0]), Number(polygon[0][0][1])];
    }
  }
  if (type === "MultiLineString" && Array.isArray(coordinates) && coordinates.length > 0) {
    const line = coordinates[0] as number[][];
    if (Array.isArray(line) && line.length > 0 && line[0].length >= 2) {
      return [Number(line[0][0]), Number(line[0][1])];
    }
  }
  return null;
}

export async function getProtectedAreaLayer(bbox: Bbox | null, limit: number = DEFAULT_FEATURE_LIMIT): Promise<FeatureCollection> {
  const maxRows = Math.max(1, Math.min(limit, DEFAULT_FEATURE_LIMIT));
  const rows = bbox
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
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.geom, 50), 4326)) AS geojson
          FROM env.natura2000_area na
          WHERE na.geom && ST_Transform(
            ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
            3006
          )
          AND ST_Intersects(
            na.geom,
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
            ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(na.geom, 50), 4326)) AS geojson
          FROM env.natura2000_area na
        ) protected_hits
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
      source: "local_postgis",
      available: true,
      manualReviewRequired: false,
      coverageMode: "complete",
    },
  );
}

export async function getSguGroundLayerLayer(bbox: Bbox): Promise<FeatureCollection> {
  const rows = await prisma.$queryRaw<GroundLayerRow[]>`
    SELECT
      source_key,
      layer_code,
      layer_label,
      map_type,
      source_scale,
      ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 100), 4326)) AS geojson
    FROM env.sgu_ground_layer
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
    LIMIT ${DEFAULT_FEATURE_LIMIT};
  `;

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

export async function getSguLandslideLayer(bbox: Bbox): Promise<FeatureCollection> {
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

export async function getHydroLayer(kind: "lakes" | "streams", bbox: Bbox | null): Promise<FeatureCollection> {
  if (!bbox) {
    return {
      type: "FeatureCollection",
      features: [],
      meta: {
        source: "unavailable",
        available: false,
        manualReviewRequired: true,
        warning: "bbox kravs for hydrolager.",
      },
    };
  }

  const tableName = kind === "lakes" ? "lake" : "stream";
  const localTableExists = await tableExists("hydro", tableName);

  if (localTableExists) {
    const rows = kind === "lakes"
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
        source: "local_postgis",
      }),
      {
        source: "local_postgis",
        available: true,
        manualReviewRequired: false,
      },
    );
  }

  return {
    type: "FeatureCollection",
    features: [],
    meta: {
      source: "unavailable",
      available: false,
      manualReviewRequired: true,
      warning:
        kind === "lakes"
          ? "Lokal hydrotabell for sjoar saknas. Officiell VISS API kravs for extern vattenfallback och anvands inte anonymt."
          : "Lokal hydrotabell for vattendrag saknas. Officiell VISS API kravs for extern vattenfallback och anvands inte anonymt.",
    },
  };
}

export async function runWaterAudit(lat: number, lng: number): Promise<PublicWaterAudit> {
  if (await tableExists("hydro", "water_body")) {
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
        source: "local_postgis",
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
        source: "unavailable",
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
    source: "unavailable",
    sourceAvailable: false,
    manualReviewRequired: true,
    warning:
      "Lokal hydrologitabell saknas och VISS_API_KEY ar inte konfigurerad for extern vattenkontroll.",
  };
}

async function fetchRaaFeatures(layerName: string, bbox: Bbox, count: number = 100): Promise<RaaFeature[]> {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layerName,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: String(count),
    bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat},EPSG:4326`,
  });
  const data = await fetchJsonWithTimeout<{ features?: RaaFeature[] }>(`${RAA_WFS_URL}?${params.toString()}`);
  return Array.isArray(data.features) ? data.features : [];
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
    object_type: String(feature.properties?.lamningstyp || feature.properties?.objekttyp || "Okand lamning"),
    name: String(feature.properties?.namn || feature.properties?.raa_nummer || "Namn saknas"),
    protection_class: feature.properties?.antikvarisk_bedomning
      ? String(feature.properties.antikvarisk_bedomning)
      : null,
    distance: haversineDistanceMeters(lat, lng, hitLat, hitLng),
  };
}

export async function runHeritageAudit(lat: number, lng: number): Promise<PublicHeritageAudit> {
  if (await tableExists("culture", "heritage_object")) {
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
        object_type: hit.object_type || "Okand lamning",
        name: hit.name || "Namn saknas",
        protection_class: hit.protection_class,
        distance: Math.round(Number(hit.distance_meters)),
      })),
      hasHeritageRisk: hits.length > 0,
      buffer_meters: HERITAGE_BUFFER_METERS,
      source: "local_postgis",
      sourceAvailable: true,
      manualReviewRequired: false,
    };
  }

  try {
    const bbox = pointBbox(lat, lng, 0.01);
    const featureGroups = await Promise.all([
      fetchRaaFeatures("lamningar_v1:fornlamning", bbox, 100),
      fetchRaaFeatures("lamningar_v1:mojligfornlamning", bbox, 100),
      fetchRaaFeatures("lamningar_v1:ovrkulthistlamning", bbox, 100),
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
      source: "raa_live",
      sourceAvailable: true,
      manualReviewRequired: true,
      warning: "Lokal kulturtabell saknas. RAA livefallback anvands och ska granskas manuellt.",
    };
  } catch (error) {
    return {
      hits: [],
      hasHeritageRisk: false,
      buffer_meters: HERITAGE_BUFFER_METERS,
      source: "unavailable",
      sourceAvailable: false,
      manualReviewRequired: true,
      warning: `RAA livekontroll misslyckades: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runClimateAudit(lat: number, lng: number): Promise<PublicClimateAudit> {
  if (await tableExists("climate", "flood_risk_area")) {
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

    const returnPeriods = [...new Set(hits.map((hit) => hit.return_period).filter((value): value is string => Boolean(value)))];
    return {
      isFlooded: hits.length > 0,
      sourceAvailable: true,
      manualReviewRequired: false,
      source: "local_postgis",
      hitCount: hits.length,
      warning:
        hits.length > 0
          ? `Lokal oversvamningsdatabas markerar traff. ${returnPeriods.length > 0 ? `Returperiod: ${returnPeriods.join(", ")}.` : "Returperiod saknas i lokalt urval."}`
          : undefined,
    };
  }

  try {
    const bbox = pointBbox(lat, lng, 0.01);
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "oversvamning:NZ_Oversvamning_100",
      outputFormat: "application/json",
      srsName: "EPSG:4326",
      count: "50",
      bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat},EPSG:4326`,
    });
    const data = await fetchJsonWithTimeout<{ features?: Array<unknown> }>(`${MSB_FLOOD_WFS_URL}?${params.toString()}`, 5000);
    const hitCount = Array.isArray(data.features) ? data.features.length : 0;
    return {
      isFlooded: hitCount > 0,
      sourceAvailable: true,
      manualReviewRequired: true,
      source: "msb_live",
      hitCount,
      warning: "MSB livekontroll ar indikativ och maste granskas manuellt innan slutsats.",
    };
  } catch (error) {
    return {
      isFlooded: null,
      sourceAvailable: false,
      manualReviewRequired: true,
      source: "unavailable",
      hitCount: 0,
      warning: `MSB livekontroll misslyckades: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function providerLabel(name: string, implementationKey?: string): string {
  if (implementationKey === "bankid") return "BankID";
  if (implementationKey === "slu") return "SLU";
  if (implementationKey?.startsWith("lantmateriet")) return "Lantmateriet";
  return name;
}

function resolveSourceDataType(implementationKey?: string, activation: ActivationClass = "IMMEDIATE"): string {
  if (implementationKey === "smhi") return "Vader och hydrologi";
  if (implementationKey === "scb") return "Statistik API";
  if (implementationKey === "sgu") return "Geodata och OGC";
  if (implementationKey === "lansstyrelsen") return "Regional geodata";
  if (implementationKey === "riksantikvarieambetet") return "Kulturmiljo";
  if (implementationKey === "naturvardsverket") return "Skyddad natur";
  if (implementationKey?.startsWith("lantmateriet")) return "Fastighets- och geodata";
  if (implementationKey === "msb") return "Risklager";
  if (implementationKey === "slu") return "Artdata";
  if (implementationKey === "kommun_kontakter_csv") return "Lokal CSV";
  if (implementationKey === "kommunala_diarier") return "Diarieindex";
  if (implementationKey === "smp") return "Portal";
  if (implementationKey === "trafikverket") return "Transportdata";
  if (implementationKey === "bankid") return "E-legitimering";
  return activation === "PERMIT_REQUIRED" ? "Avtalsstyrd integration" : "Oppna datakallor";
}

function integrationComplexity(activation: ActivationClass, key?: string): 1 | 2 | 3 | 4 | 5 {
  if (activation === "PERMIT_REQUIRED") return 4;
  if (key === "smhi" || key === "msb") return 5;
  if (key === "sgu" || key === "slu" || key === "lansstyrelsen" || key === "riksantikvarieambetet") return 4;
  if (key === "scb" || key === "kommun_kontakter_csv" || key === "kommunala_diarier") return 2;
  return 3;
}

function formatLastSync(latencyMs?: number, status?: number): string {
  if (typeof latencyMs === "number" && typeof status === "number") {
    return `${status} / ${latencyMs} ms`;
  }
  if (typeof latencyMs === "number") {
    return `${latencyMs} ms`;
  }
  return "Ej testad";
}

function hasBankIdConfig(): boolean {
  const hasPfx = Boolean(String(process.env.BANKID_PFX_PATH || "").trim());
  const hasPemPair = Boolean(
    String(process.env.BANKID_CERT_PATH || "").trim() && String(process.env.BANKID_KEY_PATH || "").trim(),
  );
  return Boolean(String(process.env.BANKID_BASE_URL || "").trim()) && (hasPfx || hasPemPair);
}

function hasLicensedLantmaterietConfig(): boolean {
  const hasOauthPair = Boolean(
    String(process.env.LANTMATERIET_CONSUMER_KEY || "").trim() &&
      String(process.env.LANTMATERIET_CONSUMER_SECRET || "").trim(),
  );
  const hasApiKey = Boolean(String(process.env.LANTMATERIET_API_KEY || "").trim());
  return hasOauthPair || hasApiKey;
}

async function getSluRuntimeSummary(): Promise<SluRuntimeSummary> {
  const productStatus = getSluProductStatus();
  const missingConfig = productStatus.filter((product) => !product.hasApiKey || !product.hasBasePath);
  if (missingConfig.length > 0) {
    return {
      ready: false,
      reason: "SLU saknar API-nyckel eller base-path.",
    };
  }

  const products = productStatus.map((product) => product.product);
  const pingResults = await Promise.allSettled(products.map((product) => pingSluProduct(product)));
  const failingProducts = pingResults
    .map((result, index) => {
      if (result.status === "fulfilled" && result.value.ok) return null;
      const product = products[index];
      if (result.status === "fulfilled") {
        return `${product} (${result.value.status})`;
      }
      return `${product} (${result.reason instanceof Error ? result.reason.message : "ping failed"})`;
    })
    .filter((value): value is string => Boolean(value));

  if (failingProducts.length > 0) {
    return {
      ready: false,
      reason: `SLU svarar inte korrekt for: ${failingProducts.join(", ")}.`,
    };
  }

  const firstEndpoint = pingResults.find((result) => result.status === "fulfilled" && result.value.ok);
  return {
    ready: true,
    reason: "SLU produkter ar konfigurerade och svarar live.",
    endpoint: firstEndpoint && firstEndpoint.status === "fulfilled" ? firstEndpoint.value.endpoint : undefined,
  };
}

function buildCardFromCatalog(
  source: (typeof SOURCE_CATALOG)[number],
  openResult?: OpenSyncResult,
  sluRuntime?: SluRuntimeSummary,
): PublicIntegrationCard {
  let status: PublicIntegrationStatus = source.activation === "PERMIT_REQUIRED" ? "DISCONNECTED" : "CONNECTED";
  let reason = source.reason;
  let endpoint = openResult?.endpoint;
  let latencyMs: number | undefined;
  let statusCode: number | undefined;

  if (source.implementationKey === "bankid") {
    status = hasBankIdConfig() ? "CONNECTED" : "DISCONNECTED";
    reason = hasBankIdConfig()
      ? "BankID mTLS och base-url ar konfigurerade."
      : "BankID saknar certifikat eller base-url.";
  } else if (source.implementationKey === "lantmateriet_licensed") {
    status = hasLicensedLantmaterietConfig() ? "CONNECTED" : "DISCONNECTED";
    reason = hasLicensedLantmaterietConfig()
      ? "Licensierad Lantmateriet-konfiguration finns i miljo."
      : "Licensierad Lantmateriet-konfiguration saknas.";
  } else if (source.implementationKey === "slu") {
    const sluReady = sluRuntime?.ready ?? false;
    status = sluReady ? "CONNECTED" : "DISCONNECTED";
    reason = sluRuntime?.reason || "SLU saknar API-nyckel eller base-path.";
    endpoint = sluRuntime?.endpoint;
  }

  if (openResult) {
    const permitGatedRuntime = source.activation === "PERMIT_REQUIRED" && !openResult.ok;
    status = permitGatedRuntime ? "DISCONNECTED" : openResult.ok ? "CONNECTED" : "ERROR";
    reason = openResult.ok
      ? `Livecheck OK (${openResult.status || "n/a"})`
      : permitGatedRuntime
        ? source.reason
        : openResult.details || `Livecheck failed (${openResult.status || "n/a"})`;
    statusCode = openResult.status;
    latencyMs = undefined;
  }

  return {
    id: source.implementationKey || source.name.toLowerCase().replace(/\s+/g, "-"),
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

export async function getPublicDatasourceSummary(forceRefresh: boolean = false): Promise<PublicDatasourceSummary> {
  if (!forceRefresh && cachedSummary && cachedSummary.expiresAt > Date.now()) {
    return cachedSummary.value;
  }

  const openResults = await fetchImmediateOpenSources();
  const openByKey = new Map<string, OpenSyncResult>();
  for (const result of openResults) {
    openByKey.set(result.source, result);
  }
  const sluRuntime = await getSluRuntimeSummary();

  const cards = SOURCE_CATALOG
    .filter((source) => !EXCLUDED_PUBLIC_SUMMARY_KEYS.has(String(source.implementationKey || "")))
    .map((source) =>
      buildCardFromCatalog(
        source,
        source.implementationKey ? openByKey.get(source.implementationKey) : undefined,
        source.implementationKey === "slu" ? sluRuntime : undefined,
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
