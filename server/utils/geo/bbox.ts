/**
 * Bounding box helpers shared by GIS routes and PostGIS layer services.
 */

export type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export function parseBbox(raw: string | null): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}
