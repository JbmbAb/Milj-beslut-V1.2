/**
 * geoUtils.ts
 *
 * Geografiska hjälpfunktioner.
 * Portad från Ny plattform (api/location.py) till TypeScript.
 */

/**
 * Beräknar avstånd i km mellan två koordinater (Haversine-formeln).
 *
 * @example
 *   haversineKm(59.334, 18.063, 57.708, 11.974) // Stockholm → Göteborg ≈ 416 km
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dlat = toRad(lat2 - lat1);
  const dlng = toRad(lng2 - lng1);

  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Beräknar om en koordinat är inom en given radie från en referenspunkt.
 */
export function isWithinRadiusKm(
  refLat: number,
  refLng: number,
  targetLat: number,
  targetLng: number,
  radiusKm: number,
): boolean {
  return haversineKm(refLat, refLng, targetLat, targetLng) <= radiusKm;
}

/**
 * Enkel bounding box-kontroll (snabbare än Haversine för grov filtrering).
 */
export function isWithinBoundingBox(
  lat: number,
  lng: number,
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): boolean {
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/**
 * Lägger till "jitter" (liten slumpmässig avvikelse) på en koordinat.
 * Används för att undvika att kluster av markörer hamnar på exakt samma punkt.
 *
 * @param magnitude Maximal avvikelse i grader (standard: 0.02 ≈ 2 km)
 */
export function addCoordinateJitter(
  lat: number,
  lng: number,
  magnitude = 0.02,
): { lat: number; lng: number } {
  return {
    lat: lat + (Math.random() * 2 - 1) * magnitude,
    lng: lng + (Math.random() * 2 - 1) * magnitude,
  };
}
