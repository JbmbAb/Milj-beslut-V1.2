import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";

// Skyddsavstånd i meter för fornlämningar (kan justeras)
const HERITAGE_BUFFER_METERS = 100;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { lat, lng } = await request.json();

  if (!lat || !lng) {
    return json({ error: "Missing coordinates" }, { status: 400 });
  }

  try {
    // PostGIS-fråga: Hitta fornlämningar inom en viss radie (buffer).
    // ST_DWithin är effektivare än att skapa en buffer och köra ST_Intersects.
    const hits: { object_type: string; name: string; distance: number }[] = await prisma.$queryRaw`
      SELECT
        object_type,
        name,
        ST_Distance(
            geom,
            ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
        ) as distance
      FROM "culture"."heritage_object"
      WHERE ST_DWithin(
        geom,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006),
        ${HERITAGE_BUFFER_METERS}
      )
      ORDER BY distance ASC
      LIMIT 5;
    `;

    return json({
      hits,
      hasHeritageRisk: Array.isArray(hits) && hits.length > 0,
      buffer_meters: HERITAGE_BUFFER_METERS,
    });
  } catch (error) {
    console.error("Heritage audit error:", error);
    return json({ error: "Database query failed", details: String(error) }, { status: 500 });
  }
}