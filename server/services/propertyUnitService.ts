import { prisma } from '../db/prisma';
import { appendPropertyAudit } from '../security/auditTrail';
import { writePropertyAccessLog } from '../repositories/auditRepository';
import { assertProjectMembership } from '../repositories/projectAccessRepository';
import { assertPermission, validatePropertyLookupInput } from '../security/projectAccess';
import { SecureError } from '../security/secureErrors';
import { logger } from '../logger';
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

export const PROPERTY_LOOKUP_AMBIGUOUS = 'PROPERTY_LOOKUP_AMBIGUOUS' as const;

/** W-CATCH2 #15: no exact and no fuzzy row -- a determined absence in the local property data. */
export const LOCAL_PROPERTY_NOT_FOUND = 'LOCAL_PROPERTY_NOT_FOUND' as const;

/**
 * W-CATCH2 #15: the lookup FOUND no row (the query answered, empty) -- a determined absence, not a
 * fault. Same message as before (the generic error mapping keys on it); the stable `failureCode` lets
 * the LU bootstrap record a lasting "not in the property data" instead of a technical error. A query
 * that FAILS is never this: it propagates unchanged.
 */
export class LocalPropertyNotFoundError extends Error {
  readonly failureCode = LOCAL_PROPERTY_NOT_FOUND;

  constructor(propertyDesignation: string) {
    super(`Fastighet hittades inte i PostGIS: ${propertyDesignation}`);
    this.name = 'LocalPropertyNotFoundError';
  }
}

/**
 * U20-A (LU 72h, Chain A root fail-closed): an exact designation that matches more than one
 * `core.property_unit` row is refused, never resolved by picking a row.
 *
 * `failureCode` is the field the LU project-context bootstrap already maps to a FAILED outcome
 * (`luProjectContextBootstrap.ts`), so the refusal reaches it as PROPERTY_LOOKUP_AMBIGUOUS with no
 * centroid, observation or binding minted. As a SecureError it is a typed client error (409) on the
 * HTTP lookup routes instead of a generic 500.
 */
export class PropertyLookupAmbiguousError extends SecureError {
  readonly failureCode = PROPERTY_LOOKUP_AMBIGUOUS;

  constructor(
    readonly propertyDesignation: string,
    readonly matchCount: number,
    readonly countyCode: string | null,
  ) {
    super(
      `${PROPERTY_LOOKUP_AMBIGUOUS}: exact designation "${propertyDesignation}" matched ${matchCount} property_unit rows` +
        `${countyCode ? ` in county ${countyCode}` : ''}; refusing to choose one`,
      'Fastighetsbeteckningen matchar flera fastighetsytor. Ingen fastighet valdes.',
      409,
      PROPERTY_LOOKUP_AMBIGUOUS,
    );
    this.name = 'PropertyLookupAmbiguousError';
  }
}

/**
 * The exact-match form of a designation: whitespace runs collapsed, trimmed, upper-cased. It never
 * strips punctuation -- unlike `core.normalize_designation`, which keeps only [a-zA-Z0-9:] and so
 * maps both "1:3>1" and "1:31" to "1:31". Mirrors the SQL expression in `runExactLookup`.
 */
function exactDesignationForm(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

type ExactLookupRow = PropertyLookupRow & { match_count?: number | string | bigint | null };

/**
 * Exact lookup = exactly one row whose designation equals the requested one (after
 * `exactDesignationForm`), within the county when one is given. `designation_norm` only narrows
 * the candidates via its index; it is not the match. `count(*) OVER ()` reports every exact match
 * even though at most two rows are fetched, and more than one is a PropertyLookupAmbiguousError --
 * there is no tie-breaker. No exact row returns null (the caller's fuzzy path is unchanged).
 */
async function runExactLookup(propertyDesignation: string, lanKod?: number): Promise<PropertyLookupRow | null> {
  const countyCode = typeof lanKod === 'number' ? String(lanKod).padStart(2, '0') : null;
  const rows = await prisma.$queryRaw<ExactLookupRow[]>`
    WITH q AS (
      SELECT
        core.normalize_designation(${propertyDesignation}) AS designation_norm,
        upper(btrim(regexp_replace(${propertyDesignation}, '[[:space:]]+', ' ', 'g'))) AS designation_exact
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
      (count(*) OVER ())::int AS match_count
    FROM core.property_unit pu, q
    WHERE pu.designation_norm = q.designation_norm
      AND upper(btrim(regexp_replace(pu.designation, '[[:space:]]+', ' ', 'g'))) = q.designation_exact
      AND (${countyCode}::text IS NULL OR pu.county_code = ${countyCode}::text)
    ORDER BY pu.source_key
    LIMIT 2;
  `;
  const wanted = exactDesignationForm(propertyDesignation);
  // Defence in depth: a row whose designation is not exactly the requested one is never an exact
  // match, whatever the query returned.
  const exactRows = (rows ?? []).filter((candidate) => exactDesignationForm(candidate.designation) === wanted);
  const matchCount = Math.max(exactRows.length, ...exactRows.map((candidate) => Number(candidate.match_count ?? 0)));
  if (matchCount > 1) {
    throw new PropertyLookupAmbiguousError(propertyDesignation, matchCount, countyCode);
  }
  return exactRows[0] ?? null;
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

  const exact = await runExactLookup(input.propertyDesignation, input.lanKod);
  const matched = exact ?? (await runFuzzyLookup(input.propertyDesignation));
  if (!matched) {
    throw new LocalPropertyNotFoundError(input.propertyDesignation);
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
  // W-CATCH2 #15: a row that cannot be presented is left out as before -- but counted, typed in the
  // meta and logged (count only, never row content), never dropped without a trace.
  let dropped = 0;
  const dropReasons = new Set<string>();
  const features = rows
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
                    // W-CATCH2 #15: unparsable raw_properties text is named as such, not "components unavailable".
                    identity_unavailable_reason: rawPropertiesUnparsable(r.raw_properties)
                      ? 'merged_property_raw_properties_unparsable'
                      : 'merged_property_source_components_unavailable',
                  }),
            },
          };
        } catch (error) {
          dropped += 1;
          dropReasons.add(error instanceof SyntaxError ? 'geometry_unparsable' : 'row_unpresentable');
          return null;
        }
      })
      .filter(Boolean);
  const dropReason = [...dropReasons].sort().join(',');
  if (dropped > 0) {
    logger.warn(`property read model: ${dropped} row(s) left out of the bbox answer (${dropReason})`);
  }
  return {
    type: 'FeatureCollection',
    features,
    meta: {
      presentation_kind: 'read_model',
      read_model_contract_version: 'read-model-feature-collection-v1',
      layer_id: READ_MODEL_LAYER_ID.PROPERTY,
      provenance_status: 'PARTIAL',
      ...(dropped > 0 ? { dropped_feature_count: dropped, dropped_feature_reason: dropReason } : {}),
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

function rawPropertiesUnparsable(rawProperties: unknown): boolean {
  return typeof rawProperties === 'string' && safeJsonParse(rawProperties) === UNPARSABLE;
}

const UNPARSABLE = Symbol('unparsable');

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // W-CATCH2 #15: a typed marker, not null -- callers can tell "could not parse" from a JSON null.
    return UNPARSABLE;
  }
}
