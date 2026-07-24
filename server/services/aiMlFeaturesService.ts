import { prisma } from '../db/prisma';

export interface GetMlFeaturesParams {
  propertyId?: string | null;
  geometry?: any | null; // GeoJSON object (WGS84)
  bufferDistance?: number;
  featureVersion?: number;
}

/**
 * Invokes the PostgreSQL get_ml_features function to perform unified, real-time spatial feature
 * extraction for properties or custom geometries. Supports buffering and versioning.
 *
 * @param params Options including propertyId, custom geometry, bufferDistance, and featureVersion.
 */
export async function getMlFeatures(params: GetMlFeaturesParams): Promise<any> {
  const propertyId = params.propertyId || null;
  const bufferDistance = params.bufferDistance ?? 0.0;
  const featureVersion = params.featureVersion ?? 1;

  let geometryGeoJson: string | null = null;
  if (params.geometry) {
    geometryGeoJson = JSON.stringify(params.geometry);
  }

  const rows = await prisma.$queryRaw<any[]>`
    SELECT public.get_ml_features(
      ${propertyId}::text,
      CASE 
        WHEN ${geometryGeoJson}::text IS NULL THEN NULL
        ELSE ST_SetSRID(ST_GeomFromGeoJSON(${geometryGeoJson}::text), 4326)
      END,
      ${bufferDistance}::double precision,
      ${featureVersion}::integer
    ) as result;
  `;

  return rows[0]?.result || { found: false };
}
