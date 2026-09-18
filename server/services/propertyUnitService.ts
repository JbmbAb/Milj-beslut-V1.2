import { prisma } from '../db/prisma';
import { appendPropertyAudit } from '../security/auditTrail';
import { writePropertyAccessLog } from '../repositories/auditRepository';
import { assertProjectMembership } from '../repositories/projectAccessRepository';
import { assertPermission, validatePropertyLookupInput } from '../security/projectAccess';
import type { AuthUser, PropertyLookupInput } from '../security/types';
import {
  createDerivedFeatureIdentity,
  createSourceFeatureIdentity,
  READ_MODEL_LAYER_ID,
  type ReadModelFeatureIdentityV1,
} from '../modules/gis/readModelFeatureIdentity';

type PropertyLookupRow = {
  source_key: string;
  designation: string;
  municipality_code: string | null;
  municipality_name: string | null;
  county_code: string | null;
  source_dataset: string;
  source_updated_at: Date | string;
  raw_properties: unknown;
  geometry_geojson: string;
  centroid_easting: number | null;
  centroid_northing: number | null;
  similarity?: number | null;
};

function mapRowToPayload(row: PropertyLookupRow, matchType: 'exact' | 'fuzzy'): Record<string, unknown> {
  const geometry = JSON.parse(row.geometry_geojson);
  const centroidSweref99Tm =
    Number.isFinite(row.centroid_easting) && Number.isFinite(row.centroid_northing)
      ? [row.centroid_easting, row.centroid_northing]
      : undefined;
  return {
    designation: row.designation,
    geometry,
    boundaries: {
      type: 'Feature',
      geometry,
      properties: {
        sourceKey: row.source_key,
        municipalityCode: row.municipality_code,
        municipalityName: row.municipality_name,
        countyCode: row.county_code,
        sourceDataset: row.source_dataset,
        sourceUpdatedAt:
          row.source_updated_at instanceof Date ? row.source_updated_at.toISOString() : row.source_updated_at,
        ...(centroidSweref99Tm ? { centroidSweref99Tm } : {}),
        similarity: row.similarity ?? undefined,
      },
    },
    ownership: undefined,
    source: 'postgis',
    matchType,
  };
}

async function runExactLookup(propertyDesignation: string, lanKod?: number): Promise<PropertyLookupRow | null> {
  const countyCode = typeof lanKod === 'number' ? String(lanKod).padStart(2, '0') : null;
  const rows = await prisma.$queryRaw<PropertyLookupRow[]>`
    WITH q AS (
      SELECT core.normalize_designation(${propertyDesignation}) AS designation_norm
    )
    SELECT
      source_key,
      designation,
      municipality_code,
      municipality_name,
      county_code,
      source_dataset,
      source_updated_at,
      raw_properties,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS geometry_geojson,
      CASE WHEN ST_IsValid(geom) AND NOT ST_IsEmpty(geom) THEN ST_X(ST_Centroid(geom)) ELSE NULL END AS centroid_easting,
      CASE WHEN ST_IsValid(geom) AND NOT ST_IsEmpty(geom) THEN ST_Y(ST_Centroid(geom)) ELSE NULL END AS centroid_northing
    FROM core.property_unit pu, q
    WHERE pu.designation_norm = q.designation_norm
      AND (${countyCode}::text IS NULL OR pu.county_code = ${countyCode}::text)
    LIMIT 1;
  `;
  return rows ? (rows[0] ?? null) : null;
}

async function runFuzzyLookup(propertyDesignation: string, lanKod?: number): Promise<PropertyLookupRow | null> {
  const countyCode = typeof lanKod === 'number' ? String(lanKod).padStart(2, '0') : null;
  const rows = await prisma.$queryRaw<PropertyLookupRow[]>`
    WITH q AS (
      SELECT core.normalize_designation(${propertyDesignation}) AS designation_norm
    )
    SELECT
      source_key,
      designation,
      municipality_code,
      municipality_name,
      county_code,
      source_dataset,
      source_updated_at,
      raw_properties,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS geometry_geojson,
      CASE WHEN ST_IsValid(geom) AND NOT ST_IsEmpty(geom) THEN ST_X(ST_Centroid(geom)) ELSE NULL END AS centroid_easting,
      CASE WHEN ST_IsValid(geom) AND NOT ST_IsEmpty(geom) THEN ST_Y(ST_Centroid(geom)) ELSE NULL END AS centroid_northing,
      similarity(pu.designation_norm, q.designation_norm) AS similarity
    FROM core.property_unit pu, q
    WHERE pu.designation_norm % q.designation_norm
      AND (${countyCode}::text IS NULL OR pu.county_code = ${countyCode}::text)
    ORDER BY similarity DESC
    LIMIT 1;
  `;
  return rows ? (rows[0] ?? null) : null;
}

export async function lookupPropertyByDesignationFromPostgis(
  input: PropertyLookupInput,
  user: AuthUser,
): Promise<Record<string, unknown>> {
  validatePropertyLookupInput(input);
  assertPermission(user, 'PROPERTY_LOOKUP');
  await assertProjectMembership({
    projectId: input.projectId,
    userId: user.id,
    organisationId: user.organisationId,
    role: user.role,
  });

  const exact = await runExactLookup(input.propertyDesignation);
  const matched = exact ?? (await runFuzzyLookup(input.propertyDesignation));
  if (!matched) {
    throw new Error(`Fastighet hittades inte i PostGIS: ${input.propertyDesignation}`);
  }

  const matchType = exact ? 'exact' : 'fuzzy';
  const payload = mapRowToPayload(matched, matchType);

  const auditEvent = {
    userId: user.id,
    projectId: input.projectId,
    propertyDesignation: input.propertyDesignation,
    purpose: input.purpose,
    responseClass: 'geometry',
  } as const;

  await appendPropertyAudit(auditEvent);
  await writePropertyAccessLog(auditEvent);

  return payload;
}

export async function getPropertyLayer(bbox: {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}, lanKod?: number): Promise<any> {
  const countyCode = typeof lanKod === 'number' ? String(lanKod).padStart(2, '0') : null;
  const rows = await prisma.$queryRaw<any[]>`
        SELECT
            source_key,
            designation,
            source_dataset,
            source_updated_at,
            raw_properties,
            ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS geometry_geojson
        FROM core.property_unit
        WHERE geom && ST_Transform(ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326), 3006)
          AND (${countyCode}::text IS NULL OR county_code = ${countyCode}::text)
        LIMIT 500
    `;
  return {
    type: 'FeatureCollection',
    features: rows
      .map((r) => {
        try {
          const identity = resolvePropertyFeatureIdentity(r);
          return {
            type: 'Feature',
            ...(identity ? { id: identity.feature_ref } : {}),
            geometry: JSON.parse(r.geometry_geojson),
            properties: {
              sourceKey: r.source_key,
              designation: r.designation,
              source_dataset: r.source_dataset,
              source_updated_at: r.source_updated_at ?? null,
              ...(identity
                ? { feature_ref: identity.feature_ref, feature_identity: identity }
                : {
                    identity_unavailable: true,
                    identity_unavailable_reason: 'merged_property_source_components_unavailable',
                  }),
            },
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean),
    meta: {
      presentation_kind: 'read_model',
      read_model_contract_version: 'read-model-feature-collection-v1',
      layer_id: READ_MODEL_LAYER_ID.PROPERTY,
      provenance_status: 'PARTIAL',
    },
  };
}

function resolvePropertyFeatureIdentity(row: {
  source_key: unknown;
  source_dataset: unknown;
  raw_properties: unknown;
}): ReadModelFeatureIdentityV1 | null {
  const sourceKey = typeof row.source_key === 'string' ? row.source_key.trim() : '';
  const sourceDataset = typeof row.source_dataset === 'string' ? row.source_dataset.trim() : '';
  if (!sourceKey || !sourceDataset) return null;

  if (!sourceKey.startsWith('merged:')) {
    return createSourceFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROPERTY,
      sourceNamespace: sourceDataset,
      sourceFeatureId: sourceKey,
    });
  }

  const components = extractMergedPropertySourceComponents(row.raw_properties);
  if (components.length === 0) return null;
  return createDerivedFeatureIdentity({
    layerId: READ_MODEL_LAYER_ID.PROPERTY,
    recipeVersion: 'property-merge-v1',
    sourceComponents: components,
  });
}

function extractMergedPropertySourceComponents(rawProperties: unknown): string[] {
  const parsed = typeof rawProperties === 'string' ? safeJsonParse(rawProperties) : rawProperties;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const objectId = (entry as Record<string, unknown>).objektidentitet;
      return typeof objectId === 'string' && objectId.trim() ? `lm:${objectId.trim()}` : null;
    })
    .filter((value): value is string => value !== null);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
