/**
 * terrainService.ts
 *
 * 3D-terrängvisualisering — levererar höjddata för en bounding box.
 *
 * Datakällor:
 *   1. TERRAIN_ENDPOINT — konfigurerbar extern höjddata-API (t.ex. Lantmäteriets
 *      Terrain API, Open-Elevation, OpenTopoData)
 *
 * Returnerar ett grid av höjdpunkter lämpliga för three.js/deck.gl terrain layer.
 *
 * Endpoint: GET /api/geo/terrain?bbox=minLng,minLat,maxLng,maxLat&resolution=32
 */

import { logger } from '../logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerrainPoint {
  lat: number;
  lng: number;
  elevationM: number;
}

export interface TerrainGrid {
  bbox: [number, number, number, number];
  resolution: number;
  points: TerrainPoint[];
  minElevation: number;
  maxElevation: number;
  source: 'live';
  fetchedAt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Hämta terrängdata för angiven bounding box.
 */
export async function getTerrainData(
  bbox: [number, number, number, number],
  resolution = 32,
): Promise<TerrainGrid> {
  const clampedResolution = Math.max(4, Math.min(128, resolution));
  const endpoint = process.env.TERRAIN_ENDPOINT;

  if (!endpoint) {
    throw new Error('TERRAIN_ENDPOINT saknas. Terrängdata är otillgänglig utan livekälla.');
  }

  try {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const url = new URL(endpoint);
    url.searchParams.set('bbox', `${minLng},${minLat},${maxLng},${maxLat}`);
    url.searchParams.set('resolution', String(clampedResolution));

    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });

    if (resp.ok) {
      const data = (await resp.json()) as Partial<TerrainGrid>;
      if (Array.isArray(data.points) && data.points.length > 0) {
        const pts = data.points as TerrainPoint[];
        const elevs = pts.map((p) => p.elevationM);
        return {
          bbox,
          resolution: clampedResolution,
          points: pts,
          minElevation: Math.min(...elevs),
          maxElevation: Math.max(...elevs),
          source: 'live',
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    throw new Error(`Terrain endpoint returned HTTP ${resp.status}`);
  } catch (err) {
    logger.warn('terrain: live endpoint failed', { err: String(err) });
    throw new Error('Terrängdata kunde inte hämtas från livekälla.');
  }
}
