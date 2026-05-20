import { prisma } from '../db/prisma';
import { tryFetchLocalProtectionData } from './hybridGeoService';

const SGU_GROUND_LAYER_TABLE = 'env.sgu_soil_type_25k_100k';

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
  const [landslide, ground, protection] = await Promise.all([
    // Check landslide risk
    prisma.$queryRaw<any[]>`
      SELECT id FROM env.sgu_landslide_feature
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      LIMIT 1
    `,
    // Get ground layer info
    prisma.$queryRawUnsafe<any[]>(
      `
        SELECT jg2_tx AS layer_label
        FROM ${SGU_GROUND_LAYER_TABLE}
        WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3006))
        LIMIT 1
      `,
      lng,
      lat,
    ),
    // Check local protection data (NVR + Natura 2000)
    tryFetchLocalProtectionData(lat, lng),
  ]);

  return {
    hasLandslideRisk: landslide.length > 0,
    groundLayerLabel: ground[0]?.layer_label || null,
    isInNatura2000: Boolean(protection?.some((p) => p.source === 'natura2000')),
    isProtectedArea: Boolean(protection?.some((p) => p.source === 'nvr')),
  };
}
