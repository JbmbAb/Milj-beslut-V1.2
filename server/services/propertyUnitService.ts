import { prisma } from '../db/prisma';
import { appendPropertyAudit } from '../security/auditTrail';
import { writePropertyAccessLog } from '../repositories/auditRepository';
import { assertProjectMembership } from '../repositories/projectAccessRepository';
import { assertPermission, validatePropertyLookupInput } from '../security/projectAccess';
import type { AuthUser, PropertyLookupInput } from '../security/types';

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
  similarity?: number | null;
};

function mapRowToPayload(row: PropertyLookupRow, matchType: 'exact' | 'fuzzy'): Record<string, unknown> {
  const geometry = JSON.parse(row.geometry_geojson);
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
      ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS geometry_geojson
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
          return {
            type: 'Feature',
            geometry: JSON.parse(r.geometry_geojson),
            properties: {
              sourceKey: r.source_key,
              designation: r.designation,
            },
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  };
}
