import { prisma } from '../db/prisma';
import { logger } from '../logger';

export interface ProtectedArea {
  name: string;
  type: string;
  id: string;
  area_ha?: number;
}

interface ProtectedAreaRow {
  id: string;
  name: string | null;
  type: string | null;
  area_ha: number | null;
  distance_m: number | null;
}

export async function fetchProtectedAreas(
  lat: number,
  lng: number,
  radiusMeters: number = 500,
): Promise<ProtectedArea[]> {
  try {
    const rows = await prisma.$queryRaw<ProtectedAreaRow[]>`
      WITH point AS (
        SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006) AS geom
      )
      SELECT
        *
      FROM (
        SELECT
          pa.nvr_id AS id,
          pa.name AS name,
          pa.protection_type AS type,
          pa.area_ha AS area_ha,
          ST_Distance(pa.wkb_geometry, point.geom) AS distance_m
        FROM env.protected_area pa, point
        WHERE ST_DWithin(pa.wkb_geometry, point.geom, ${radiusMeters})
  
        UNION ALL
  
        SELECT
          na.external_id AS id,
          na.site_name AS name,
          ('Natura 2000 ' || na.category) AS type,
          NULL::numeric AS area_ha,
          ST_Distance(na.wkb_geometry, point.geom) AS distance_m
        FROM env.natura2000_area na, point
        WHERE ST_DWithin(na.wkb_geometry, point.geom, ${radiusMeters})
      ) hits
      ORDER BY distance_m ASC NULLS LAST
      LIMIT 50;
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.name || 'Namnlost omrade',
      type: row.type || 'Skyddat omrade',
      area_ha: row.area_ha ?? undefined,
    }));
  } catch (error) {
    logger.error('NVR service query failed', { lat, lng, radiusMeters, error: String(error) });
    // Returnera tomt för att inte krascha klienten, men felet är nu loggat.
    return [];
  }
}
