/**
 * Generiska bbox-baserade kartlager från PostGIS-tabeller.
 */

import { prisma } from '../db/prisma';
import type { Bbox } from '../utils/geo/bbox';
type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJSON.Geometry;
    properties: Record<string, unknown>;
  }>;
  meta?: Record<string, unknown>;
};
import { findDatasetMapLayer } from '../datasources/platformMapLayerRegistry';

type GenericLayerRow = {
  geojson: string;
  geometry_type: string | null;
  raw_properties: Record<string, unknown> | null;
};

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

function safeParseGeometry(geojson: string): GeoJSON.Geometry | null {
  try {
    return JSON.parse(geojson) as GeoJSON.Geometry;
  } catch {
    return null;
  }
}

export async function getDatasetMapLayer(
  layerKey: string,
  bbox: Bbox,
  limit: number = 1500,
): Promise<FeatureCollection> {
  const def = findDatasetMapLayer(layerKey);
  if (!def) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: `Okänt dataset-lager: ${layerKey}`,
      },
    };
  }

  if (!(await tableExists(def.schema, def.table))) {
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: `Tabellen ${def.schema}.${def.table} saknas i PostGIS.`,
        layerKey: def.key,
        label: def.label,
      },
    };
  }

  const maxRows = Math.max(1, Math.min(limit, 3000));
  const schemaSql = quotePgIdentifier(def.schema);
  const tableSql = quotePgIdentifier(def.table);

  let rows: GenericLayerRow[];
  try {
    rows = await prisma.$queryRawUnsafe<GenericLayerRow[]>(
      `
        SELECT
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
        FROM ${schemaSql}.${tableSql} t
        WHERE t.geom IS NOT NULL
          AND t.geom && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006)
          AND ST_Intersects(t.geom, ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006))
        LIMIT $5
      `,
      bbox.minLng,
      bbox.minLat,
      bbox.maxLng,
      bbox.maxLat,
      maxRows,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: `Kunde inte läsa ${def.schema}.${def.table}: ${message}`,
        layerKey: def.key,
      },
    };
  }

  const features = rows
    .map((row) => {
      const geometry = safeParseGeometry(row.geojson);
      if (!geometry) return null;
      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          ...(row.raw_properties ?? {}),
          layerKey: def.key,
          layerLabel: def.label,
          geometryType: row.geometry_type,
          source: def.provider,
        },
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    type: 'FeatureCollection',
    features,
    meta: {
      source: 'local_postgis',
      available: true,
      screeningOnly: true,
      manualReviewRequired: features.length > 0,
      featureLimit: maxRows,
      layerKey: def.key,
      label: def.label,
      table: `${def.schema}.${def.table}`,
    },
  };
}
