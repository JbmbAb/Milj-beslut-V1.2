/**
 * markCoverService.ts
 *
 * Marktäckekartlager (LULC — Land Use/Land Cover) för Miljöbeslut.
 *
 * Datakällor (i prioritetsordning):
 *   1. env.marktacke PostGIS-tabell (om NMD-rastret är inläst)
 *   2. LULC_ENDPOINT — konfigurerbar extern WMS/WFS-tjänst
 *   3. Syntetisk demo-polygon för bbox (fallback)
 *
 * Returnerar GeoJSON FeatureCollection med marktäckepolygoner.
 */

import { prisma } from '../db/prisma';
import { logger } from '../logger';

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
  source: 'postgis' | 'wms' | 'synthetic';
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
export async function getMarkCoverLayer(
  bbox: [number, number, number, number],
): Promise<MarkCoverResponse> {
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

  // 2. Try external WMS/WFS endpoint
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

  // 3. Synthetic demo data (always works)
  const features = generateSyntheticCover(bbox);
  return { type: 'FeatureCollection', features, source: 'synthetic', bbox, fetchedAt };
}

function generateSyntheticCover(
  bbox: [number, number, number, number],
): MarkCoverFeature[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / 3;
  const latStep = (maxLat - minLat) / 3;
  const codes = [11, 21, 41, 51, 31];

  const features: MarkCoverFeature[] = [];
  let codeIdx = 0;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const sLng = minLng + col * lngStep;
      const sLat = minLat + row * latStep;
      const eLng = sLng + lngStep;
      const eLat = sLat + latStep;
      const code = codes[codeIdx % codes.length];
      codeIdx++;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [sLng, sLat],
              [eLng, sLat],
              [eLng, eLat],
              [sLng, eLat],
              [sLng, sLat],
            ],
          ],
        },
        properties: {
          nmdCode: code,
          description: NMD_CLASSES[code] ?? 'Okänd',
          areaHa: Math.round(((eLng - sLng) * (eLat - sLat) * 111_320 * 111_320) / 10_000),
        },
      });
    }
  }

  return features;
}
