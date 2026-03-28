/**
 * terrainService.ts
 *
 * 3D-terrängvisualisering — levererar höjddata för en bounding box.
 *
 * Datakällor:
 *   1. TERRAIN_ENDPOINT — konfigurerbar extern höjddata-API (t.ex. Lantmäteriets
 *      Terrain API, Open-Elevation, OpenTopoData)
 *   2. Syntetisk terrängmodell (procedurell höjdkarta) som fallback
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
  source: 'live' | 'synthetic';
  fetchedAt: string;
}

// ─── Synthetic terrain generator ──────────────────────────────────────────────

/**
 * Generera realistisk syntetisk terräng med kombinerade sinusvågor (Perlin-liknande).
 */
function generateSyntheticTerrain(
  bbox: [number, number, number, number],
  resolution: number,
): TerrainGrid {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const points: TerrainPoint[] = [];

  // Seed based on bbox centre for deterministic output
  const seedLat = (minLat + maxLat) / 2;
  const seedLng = (minLng + maxLng) / 2;

  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const lat = minLat + ((maxLat - minLat) * row) / (resolution - 1);
      const lng = minLng + ((maxLng - minLng) * col) / (resolution - 1);

      // Multi-octave procedural elevation
      const nx = (lng - seedLng) * 80;
      const ny = (lat - seedLat) * 80;

      const elevationM =
        50 +
        60 * Math.sin(nx * 0.3 + 1.2) * Math.cos(ny * 0.25) +
        30 * Math.sin(nx * 0.7 + 2.1) * Math.sin(ny * 0.6 + 0.8) +
        15 * Math.cos(nx * 1.4 + 0.5) * Math.cos(ny * 1.1 + 1.3) +
        8 * Math.sin(nx * 2.8) * Math.cos(ny * 2.2 + 0.4);

      const e = Math.round(Math.max(0, elevationM) * 10) / 10;
      if (e < minElevation) minElevation = e;
      if (e > maxElevation) maxElevation = e;

      points.push({ lat, lng, elevationM: e });
    }
  }

  return {
    bbox,
    resolution,
    points,
    minElevation: Math.round(minElevation * 10) / 10,
    maxElevation: Math.round(maxElevation * 10) / 10,
    source: 'synthetic',
    fetchedAt: new Date().toISOString(),
  };
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

  if (endpoint) {
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
    } catch (err) {
      logger.warn('terrain: live endpoint failed', { err: String(err) });
    }
  }

  return generateSyntheticTerrain(bbox, clampedResolution);
}
