/**
 * Assembles property lookup + spatial distance into prompt/context for AI/report flows.
 * Modular Stage-2 pipeline helper (lookup → spatial → prompt compilation).
 */

import { prisma } from '../../db/prisma';

export interface PropertyLookupLike {
  designation?: unknown;
  geometry?: unknown;
  source?: unknown;
  matchType?: unknown;
}

export interface PropertyPipelineContext {
  designation: string;
  source: string;
  matchType: string | null;
  centroid: { lng: number; lat: number } | null;
  distanceToWaterMeters: number | null;
  promptText: string;
  promptFields: {
    designation: string;
    waterDistanceMeters: number | null;
    hasGeometry: boolean;
    centroidLng: number | null;
    centroidLat: number | null;
  };
}

function extractRing(geometry: unknown): number[][] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return [[Number(g.coordinates[0]), Number(g.coordinates[1])]];
  }
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
    return g.coordinates[0] as number[][];
  }
  if (
    g.type === 'MultiPolygon' &&
    Array.isArray(g.coordinates) &&
    Array.isArray(g.coordinates[0]) &&
    Array.isArray(g.coordinates[0][0])
  ) {
    return g.coordinates[0][0] as number[][];
  }
  return null;
}

/** Centroid from GeoJSON geometry (WGS84). */
export function centroidFromGeoJson(geometry: unknown): { lng: number; lat: number } | null {
  const ring = extractRing(geometry);
  if (!ring || ring.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    sumLng += lng;
    sumLat += lat;
    n += 1;
  }
  if (n === 0) return null;
  return { lng: sumLng / n, lat: sumLat / n };
}

/** Min distance (m) from property designation to nearest topo10.vatten (SRID 3006). */
export async function distanceToWaterByDesignation(designation: string): Promise<number | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ dist: number | null }>>(
    `SELECT ST_Distance(pu.geom, w.geom) AS dist
     FROM core.property_unit pu, topo10.vatten w
     WHERE pu.designation = $1
       AND pu.geom IS NOT NULL
       AND w.geom IS NOT NULL
     ORDER BY pu.geom <-> w.geom
     LIMIT 1`,
    designation,
  );
  const dist = rows[0]?.dist;
  return dist == null ? null : Number(dist);
}

/** Compile structured prompt context from a PostGIS lookup payload. */
export async function compilePropertyPromptContext(
  lookup: PropertyLookupLike,
): Promise<PropertyPipelineContext> {
  const designation = String(lookup.designation || '').trim();
  if (!designation) {
    throw new Error('Property lookup saknar designation');
  }

  const centroid = centroidFromGeoJson(lookup.geometry);
  const distanceToWaterMeters = await distanceToWaterByDesignation(designation);
  const hasGeometry = Boolean(lookup.geometry);

  const waterPart =
    distanceToWaterMeters == null
      ? 'Avstånd till närmaste vattenförekomst: ej beräknat.'
      : `Avstånd till närmaste vattenförekomst: ${distanceToWaterMeters.toFixed(2)} m.`;

  const centroidPart =
    centroid == null
      ? 'Centroid: saknas.'
      : `Centroid (WGS84): ${centroid.lng.toFixed(6)}, ${centroid.lat.toFixed(6)}.`;

  const promptText = [
    `Fastighet: ${designation}.`,
    `Källa: ${String(lookup.source || 'unknown')}.`,
    `Geometri: ${hasGeometry ? 'ja' : 'nej'}.`,
    centroidPart,
    waterPart,
  ].join(' ');

  return {
    designation,
    source: String(lookup.source || 'unknown'),
    matchType: lookup.matchType == null ? null : String(lookup.matchType),
    centroid,
    distanceToWaterMeters,
    promptText,
    promptFields: {
      designation,
      waterDistanceMeters: distanceToWaterMeters,
      hasGeometry,
      centroidLng: centroid?.lng ?? null,
      centroidLat: centroid?.lat ?? null,
    },
  };
}
