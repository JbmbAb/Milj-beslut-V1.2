import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../logger';

const prisma = new PrismaClient();

export interface LocalGeoFeature {
  designation: string;
  source: 'local_db';
  geometry: unknown;
  boundaries: unknown;
}

/**
 * Kontrollerar om vi har lokal fastighetsgeometri från Lantmäteriet inkopierad i databasen.
 * Den letar i det isolerade `env`-schemat.
 */
export async function tryFetchLocalPropertyGeometry(designation: string): Promise<LocalGeoFeature | null> {
  try {
    const rawParts = designation.split(/\s+/);
    if (rawParts.length < 2) return null;

    const label = rawParts[rawParts.length - 1];
    const tract = rawParts[rawParts.length - 2];
    const muni = rawParts.slice(0, rawParts.length - 2).join(' ');

    const municipalityCondition = muni ? Prisma.sql`AND kommunnamn = ${muni.toUpperCase()}` : Prisma.empty;

    // Uppslag mot env.registerenhetsomradesytor (PostGIS)
    // ST_AsGeoJSON konverterar PostGIS geometri till frontend-vänligt GeoJSON
    const result = await prisma.$queryRaw<any[]>`
      SELECT 
        etikett, 
        kommunnamn, 
        trakt, 
        ST_AsGeoJSON(geom)::json AS geometry
      FROM env.registerenhetsomradesytor
      WHERE etikett = ${label}
        AND trakt = ${tract.toUpperCase()}
        ${municipalityCondition}
      LIMIT 1;
    `;

    if (result && result.length > 0) {
      logger.info(`Hybrid Fallback: Hittade ${designation} LOKALT i databasen (0ms)!`);
      const row = result[0];
      return {
        designation: `${row.kommunnamn} ${row.trakt} ${row.etikett}`,
        source: 'local_db',
        geometry: row.geometry,
        boundaries: {
          type: 'Feature',
          properties: { etikett: row.etikett, trakt: row.trakt, kommunnamn: row.kommunnamn },
          geometry: row.geometry,
        },
      };
    }

    return null; // Hittades inte lokalt, returnera null så vi gör en live_fetch()
  } catch (err) {
    logger.warn(
      'Kunde inte fråga lokal databas efter fastighet (tabell/schemat kanske inte existerar än):',
      err,
    );
    return null;
  }
}

/**
 * Kontrollerar om vi har SGU Jordarts-data (sgu_soil_type_25k_100k) för en punkt.
 */
export async function tryFetchLocalSguData(lat: number, lng: number): Promise<any | null> {
  try {
    const result = await prisma.$queryRaw<any[]>`
      SELECT jg2_tx, jordart
      FROM env.sgu_soil_type_25k_100k
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      LIMIT 1;
    `;
    return result[0] || null;
  } catch (err) {
    return null;
  }
}

/**
 * Kontrollerar om vi har RAÄ Kulturmiljö-data för en punkt.
 */
export async function tryFetchLocalRaaData(lat: number, lng: number): Promise<any[] | null> {
  try {
    const result = await prisma.$queryRaw<any[]>`
      SELECT id, namn, typ, beslutsdatum, ST_Distance(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)) as distance
      FROM env.kulturmiljo_omrade
      WHERE ST_DWithin(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006), 500)
      ORDER BY distance ASC
      LIMIT 10;
    `;
    return result.length > 0 ? result : null;
  } catch (err) {
    return null;
  }
}

/**
 * Kontrollerar om vi har Topo10 data för en bounding box.
 */
export async function tryFetchLocalTopo10Data(
  bbox: [number, number, number, number],
  layer: 'byggnad' | 'mark' | 'vatten' | 'vag' | 'jarnvag',
): Promise<any[] | null> {
  try {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const tableName = `topo10.${layer}`;
    const result = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT objektidentitet, objekttyp, ST_AsGeoJSON(geom)::json as geometry
      FROM ${tableName}
      WHERE ST_Intersects(geom, ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006))
      LIMIT 500;
      `,
      minLng,
      minLat,
      maxLng,
      maxLat,
    );
    return result.length > 0 ? result : null;
  } catch (err) {
    return null;
  }
}

/**
 * Kontrollerar skyddade områden och Natura 2000 för en punkt.
 */
export async function tryFetchLocalProtectionData(lat: number, lng: number): Promise<any[] | null> {
  try {
    const result = await prisma.$queryRaw<any[]>`
      SELECT nvr_id as id, name, protection_type as type, 'nvr' as source
      FROM env.protected_area
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      UNION ALL
      SELECT external_id as id, site_name as name, 'Natura 2000' as type, 'natura2000' as source
      FROM env.natura2000_area
      WHERE ST_Intersects(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006));
    `;
    return result.length > 0 ? result : null;
  } catch (err) {
    return null;
  }
}
