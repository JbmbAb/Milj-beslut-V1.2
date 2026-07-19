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
        // The geojson column is a string from the DB, parse it
        const geometry = JSON.parse(row.geojson);
        // The rest of the columns become properties for the popup
        const { geojson: _geojson, ...properties } = row;
        return {
          type: "Feature",
          geometry,
          properties
        };
      } catch {
        // Ignore rows with invalid geometry
        return null;
      }
    })
    .filter(Boolean); // Remove any nulls from failed parsing

  return {
    type: "FeatureCollection",
    features
  };
}

export async function loader() {
  try {
    const protectedAreas = await prisma.$queryRaw`
      SELECT *
      FROM (
        SELECT
          nvr_id,
          name,
          protection_type,
          'NVR'::text AS source,
          ST_AsGeoJSON(geom) AS geojson
        FROM "env"."protected_area"
        WHERE geom IS NOT NULL

        UNION ALL

        SELECT
          external_id AS nvr_id,
          site_name AS name,
          ('Natura 2000 ' || category) AS protection_type,
          'Natura2000'::text AS source,
          ST_AsGeoJSON(geom) AS geojson
        FROM "env"."natura2000_area"
        WHERE geom IS NOT NULL
      ) areas
      LIMIT 1000;
    `;
    return json(toFeatureCollection(Array.isArray(protectedAreas) ? protectedAreas : []));
  } catch (error) {
    return json({ error: "Failed to fetch data from PostGIS", details: String(error) }, { status: 500 });
  }
}
