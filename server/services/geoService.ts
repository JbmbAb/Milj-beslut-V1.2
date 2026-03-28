import { prisma } from "../db/prisma";

export interface GeoRiskStatus {
  hasLandslideRisk: boolean;
  groundLayerLabel: string | null;
  isInNatura2000: boolean;
  isProtectedArea: boolean;
}

/**
 * Checks geospatial risks for a given coordinate (WGS84) against SGU and environmental layers.
 * 
 * Uses ST_Intersects and ST_Transform to match coordinates with the SWEREF99 TM (3006) 
 * projection used in the env schema.
 */
export async function checkGeospatialRisks(lat: number, lng: number): Promise<GeoRiskStatus> {
  const [landslide, ground, natura, protectedArea] = await Promise.all([
    // Check landslide risk
    prisma.$queryRaw<any[]>`
      SELECT id FROM env.sgu_landslide_feature
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      LIMIT 1
    `,
    // Get ground layer info
    prisma.$queryRaw<any[]>`
      SELECT layer_label FROM env.sgu_ground_layer
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      LIMIT 1
    `,
    // Check Natura 2000
    prisma.$queryRaw<any[]>`
      SELECT external_id FROM env.natura2000_area
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      LIMIT 1
    `,
    // Check Protected Area
    prisma.$queryRaw<any[]>`
      SELECT nvr_id FROM env.protected_area
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      LIMIT 1
    `
  ]);

  return {
    hasLandslideRisk: landslide.length > 0,
    groundLayerLabel: ground[0]?.layer_label || null,
    isInNatura2000: natura.length > 0,
    isProtectedArea: protectedArea.length > 0
  };
}
