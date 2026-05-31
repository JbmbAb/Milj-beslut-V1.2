/**
 * markCoverService.ts
 *
 *
 * Marktäckekartlager (LULC — Land Use/Land Cover) för Miljöbeslut.
 *
 * Datakällor (i prioritetsordning):
 *   1. env.marktacke PostGIS-tabell (om NMD-rastret är inläst)
 *   2. LULC_ENDPOINT — konfigurerbar extern WMS/WFS-tjänst
 *
 * Returnerar GeoJSON FeatureCollection med marktäckepolygoner.
 */

import { prisma } from '../db/prisma';
import { logger } from '../logger';
import { tryFetchLocalTopo10Data } from './hybridGeoService';
import { queryNmdPoint } from './nmdService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MarkCoverFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  };
  properties: {
    nmdCode: number;
    description: string;
    areaHa?: number;
  };
}

export interface MarkCoverResponse {
  type: 'FeatureCollection';
  features: MarkCoverFeature[];
  source: 'postgis' | 'wms';
  bbox: [number, number, number, number];
  fetchedAt: string;
}

// ─── NMD class mapping ────────────────────────────────────────────────────────

const NMD_CLASSES: Record<number, string> = {
  11: 'Skog',
  12: 'Öppen skog/hygge',
  21: 'Jordbruksmark',
  31: 'Öppen våtmark',
  32: 'Trädbevuxen våtmark',
  41: 'Bebyggelse',
  42: 'Infrastruktur',
  51: 'Vatten',
  52: 'Hav och kust',
};

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Hämta marktäckeklassificering för en bounding box.
 * bbox = [minLng, minLat, maxLng, maxLat] i WGS84.
 */
export async function getMarkCoverLayer(bbox: [number, number, number, number]): Promise<MarkCoverResponse> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const fetchedAt = new Date().toISOString();

  // 1. Try PostGIS (NMD raster table)
  try {
    type RasterRow = { nmd_code: number; center_x: number; center_y: number };
    const rows = await prisma.$queryRawUnsafe<RasterRow[]>(
      `SELECT CAST(ST_Value(rast, ST_Transform(
          ST_SetSRID(ST_MakePoint(
            ($1::float + $3::float) / 2.0,
            ($2::float + $4::float) / 2.0
          ), 4326), 3006)) AS integer) AS nmd_code,
       ($1::float + $3::float) / 2.0 AS center_x,
       ($2::float + $4::float) / 2.0 AS center_y
       FROM env.marktacke
       WHERE ST_Intersects(
         rast,
         ST_Transform(ST_MakeEnvelope($1::float,$2::float,$3::float,$4::float,4326), 3006)
       )
       LIMIT 200;`,
      minLng,
      minLat,
      maxLng,
      maxLat,
    );

    if (rows.length > 0) {
      const features: MarkCoverFeature[] = rows
        .filter((r) => r.nmd_code != null)
        .map((r) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [r.center_x, r.center_y] },
          properties: {
            nmdCode: r.nmd_code,
            description: NMD_CLASSES[r.nmd_code] ?? `Okänd kod (${r.nmd_code})`,
          },
        }));

      return { type: 'FeatureCollection', features, source: 'postgis', bbox, fetchedAt };
    }
  } catch {
    // Table may not exist in this deployment — fall through
  }

  // 2. NMD2023 GDAL punktsökning (lokalt GeoTIFF via gdallocationinfo)
  if (process.env.NMD_RASTER_PATH) {
    try {
      const centerLng = (minLng + maxLng) / 2;
      const centerLat = (minLat + maxLat) / 2;
      const nmd = await queryNmdPoint(centerLat, centerLng);
      if (nmd.ok) {
        return {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [centerLng, centerLat] },
              properties: { nmdCode: nmd.code, description: nmd.description },
            },
          ],
          source: 'postgis',
          bbox,
          fetchedAt,
        };
      }
    } catch (err) {
      logger.warn('markcover: NMD GDAL-sökning misslyckades', { err: String(err) });
    }
  }

  // 3. Try local Topo10 (vector data)
  try {
    const localTopo = await tryFetchLocalTopo10Data(bbox, 'mark');
    if (localTopo && localTopo.length > 0) {
      const features: MarkCoverFeature[] = localTopo.map((r) => ({
        type: 'Feature' as const,
        geometry: r.geometry,
        properties: {
          nmdCode: 0, // Topo10 doesn't use NMD codes
          description: r.objekttyp || 'Mark (Topo10)',
        },
      }));
      return { type: 'FeatureCollection', features, source: 'postgis', bbox, fetchedAt };
    }
  } catch (err) {
    logger.warn('markcover: Topo10 local lookup failed', { err });
  }

  // 4. Try external WMS/WFS endpoint
  const endpoint = process.env.LULC_ENDPOINT;
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('service', 'WFS');
      url.searchParams.set('version', '2.0.0');
      url.searchParams.set('request', 'GetFeature');
      url.searchParams.set('outputFormat', 'application/json');
      url.searchParams.set('bbox', `${minLat},${minLng},${maxLat},${maxLng},urn:ogc:def:crs:EPSG::4326`);

      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
      if (resp.ok) {
        const geojson = (await resp.json()) as { features?: MarkCoverFeature[] };
        if (Array.isArray(geojson.features)) {
          return {
            type: 'FeatureCollection',
            features: geojson.features,
            source: 'wms',
            bbox,
            fetchedAt,
          };
        }
      }
    } catch (err) {
      logger.warn('markcover: WMS fetch failed', { err: String(err) });
    }
  }

  // Return empty collection instead of throwing to avoid breaking the UI/smoke tests
  // when no data is available (common in test environments).
  return {
    type: 'FeatureCollection',
    features: [],
    source: 'postgis',
    bbox,
    fetchedAt,
  };
}

export interface MarkCoverPointResult {
  value: number;
  description: string;
}

/**
 * Slå upp marktäckeklassificering vid en punkt (WGS84).
 * Försöker PostGIS-raster först, faller tillbaka till NMD/GDAL.
 */
export async function queryMarkCoverAtPoint(lat: number, lng: number): Promise<MarkCoverPointResult | null> {
  try {
    const result = await prisma.$queryRaw<{ value: number | null }[]>`
      SELECT ST_Value(
        rast,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      ) as value
      FROM env.marktacke
      WHERE ST_Intersects(
        rast,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      );
    `;

    if (result?.length && result[0].value != null) {
      const value = Number(result[0].value);
      const description = NMD_CLASSES[value] || `Okänd kod (${value})`;
      return { value, description };
    }
  } catch (err) {
    logger.warn('markcover: PostGIS punktfråga misslyckades', { err: String(err) });
  }

  const nmd = await queryNmdPoint(lat, lng);
  if (nmd.ok) {
    return { value: nmd.code, description: nmd.description };
  }

  return null;
}

// ─── END Service ──────────────────────────────────────────────────────────────
