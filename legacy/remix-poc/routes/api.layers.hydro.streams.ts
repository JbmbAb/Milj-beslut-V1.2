import { json } from "@remix-run/node";
import { prisma } from "~/db.server";

/**
 * Formats database rows into a GeoJSON FeatureCollection.
 * Each row must have a 'geojson' column containing a GeoJSON geometry string.
 */
function toFeatureCollection(rows: any[]) {
  const features = rows
    .map(row => {
      try {
        const geometry = JSON.parse(row.geojson);
        const { geojson: _geojson, ...properties } = row;
        return {
          type: "Feature",
          geometry,
          properties
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features
  };
}

export async function loader() {
  try {
    const features = await prisma.$queryRaw`
      SELECT objid, namn, kategori, ST_AsGeoJSON(geom) as geojson
      FROM "hydro"."stream"
      WHERE geom IS NOT NULL
      LIMIT 5000;
    `;
    return json(toFeatureCollection(Array.isArray(features) ? features : []));
  } catch (error) {
    console.error("PostGIS Stream Layer Error:", error);
    return json({ error: "Failed to fetch stream data from PostGIS", details: String(error) }, { status: 500 });
  }
}
