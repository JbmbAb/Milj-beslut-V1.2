import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { lat, lng } = await request.json();

  if (!lat || !lng) {
    return json({ error: "Missing coordinates" }, { status: 400 });
  }

  try {
    // PostGIS-fråga: Hitta översvämningsområden som överlappar med punkten
    // Punkten transformeras från WGS84 (4326) till SWEREF 99 TM (3006)
    const hits: { return_period: string }[] = await prisma.$queryRaw`
      SELECT
        external_id,
        source,
        return_period
      FROM "climate"."flood_risk_area"
      WHERE ST_Intersects(
        geom,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      )
    `;

    // Returnera träffar
    return json({
      hits,
      isFlooded: Array.isArray(hits) && hits.length > 0
    });
  } catch (error) {
    console.error("Flood audit error:", error);
    return json({ error: "Database query failed", details: String(error) }, { status: 500 });
  }
}