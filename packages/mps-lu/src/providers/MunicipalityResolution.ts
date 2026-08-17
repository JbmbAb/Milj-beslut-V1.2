import type { CanonicalGeometry } from "../domain/CanonicalGeometry";

/**
 * 🜃 DOCUMENT_PROVIDER_LOCATION_FAIL_CLOSED-01 — DOCUMENT_PROVIDER_LOCATION_AUTHORITY_V1.
 *
 * Three states, kept apart.
 *
 * `PostgisDocumentProvider` previously collapsed all three into one string:
 *
 *   .catch(() => [])                collapsed QUERY_FAILED into NO_MATCH
 *   res[0]?.kommunnamn || "Mora"    collapsed both into RESOLVED("Mora")
 *
 * so a database failure produced documents for a jurisdiction the geometry never resolved to.
 * The governed classification chain would then have been applied to that wrong selection —
 * correctly, which is precisely what makes it dangerous.
 *
 * Modelled as a discriminated union rather than `string | undefined`, because nullability is how
 * this returns: an empty string or a `??` further down the call path re-introduces the same
 * fabrication in a new place. A local provider-layer type is enough; this is deliberately not a
 * platform abstraction.
 */
export type MunicipalityResolution =
  | { readonly status: "RESOLVED"; readonly municipality: string }
  | { readonly status: "UNRESOLVED" }
  | { readonly status: "RESOLUTION_FAILED"; readonly reason: string };

/** The narrow slice of the database this resolution needs. */
export interface SpatialQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

const MUNICIPALITY_QUERY = `
      SELECT DISTINCT name AS kommunnamn
      FROM hydro.water_catchment
      WHERE geom && ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 3006)
      LIMIT 1
    `;

/**
 * Resolves the municipality a geometry falls in.
 *
 * A thrown query yields RESOLUTION_FAILED, never an empty result. One is an error and the other
 * is a finding; a caller that cannot tell them apart cannot fail closed on the first.
 *
 * A blank name is treated as UNRESOLVED rather than as a municipality called "". Otherwise the
 * emptiness would travel as a valid identity into the document lookup.
 */
export async function resolveMunicipality(
  client: SpatialQueryClient,
  geometry: CanonicalGeometry,
): Promise<MunicipalityResolution> {
  let rows: Array<{ kommunnamn: string | null }>;
  try {
    rows = await client.$queryRawUnsafe<Array<{ kommunnamn: string | null }>>(
      MUNICIPALITY_QUERY,
      JSON.stringify(geometry),
    );
  } catch (error) {
    return { status: "RESOLUTION_FAILED", reason: (error as Error).message };
  }

  const name = rows?.[0]?.kommunnamn;
  if (typeof name !== "string" || name.trim() === "") {
    return { status: "UNRESOLVED" };
  }
  return { status: "RESOLVED", municipality: name };
}
