import crypto from "node:crypto";

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusMeters = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

export interface Monument {
  id: string;
  name: string;
  type: string;
  distance: number;
}

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

function geometryReferencePoint(geometry: GeoJsonGeometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  const { type, coordinates } = geometry;

  if (type === "Point" && Array.isArray(coordinates) && coordinates.length >= 2) {
    return [Number(coordinates[0]), Number(coordinates[1])];
  }

  if (type === "LineString" && Array.isArray(coordinates) && coordinates.length > 0) {
    const point = coordinates[0] as number[];
    if (Array.isArray(point) && point.length >= 2) {
      return [Number(point[0]), Number(point[1])];
    }
  }

  if (type === "Polygon" && Array.isArray(coordinates) && coordinates.length > 0) {
    const ring = coordinates[0] as number[][];
    if (Array.isArray(ring) && ring.length > 0 && ring[0].length >= 2) {
      return [Number(ring[0][0]), Number(ring[0][1])];
    }
  }

  if (type === "MultiPolygon" && Array.isArray(coordinates) && coordinates.length > 0) {
    const polygon = coordinates[0] as number[][][];
    if (Array.isArray(polygon) && polygon.length > 0 && polygon[0].length > 0 && polygon[0][0].length >= 2) {
      return [Number(polygon[0][0][0]), Number(polygon[0][0][1])];
    }
  }

  if (type === "MultiLineString" && Array.isArray(coordinates) && coordinates.length > 0) {
    const line = coordinates[0] as number[][];
    if (Array.isArray(line) && line.length > 0 && line[0].length >= 2) {
      return [Number(line[0][0]), Number(line[0][1])];
    }
  }

  return null;
}

export async function fetchAncientMonuments(lat: number, lng: number): Promise<Monument[]> {
  const radiusInDegrees = 0.005;
  const bbox = `${lng - radiusInDegrees},${lat - radiusInDegrees},${lng + radiusInDegrees},${lat + radiusInDegrees},urn:ogc:def:crs:EPSG::4326`;
  const url = `https://pub.raa.se/visning/lamningar_v1/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=lamningar_v1:fornlamning&outputFormat=application/json&bbox=${bbox}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    return (data.features || [])
      .map((feature: any) => {
        const point = geometryReferencePoint(feature.geometry);
        if (!point) return null;

        const [featureLng, featureLat] = point;
        const properties = feature.properties || {};
        return {
          id: String(feature.id || properties.lamningsnummer || properties.raa_nummer || crypto.randomUUID()),
          name: String(properties.namn || properties.lamningstyp || "Fornlamning"),
          type: String(properties.antikvarisk_bedomning || properties.lamningstyp || "Kulturarv"),
          distance: calculateDistance(lat, lng, featureLat, featureLng),
        } satisfies Monument;
      })
      .filter((feature: Monument | null): feature is Monument => Boolean(feature));
  } catch (error) {
    console.error("RAA fetch failed:", error);
    return [];
  }
}
