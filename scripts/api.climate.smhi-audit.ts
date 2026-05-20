import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";

const SMHI_WFS_URL = "https://geoserver.smhi.se/geoserver/wfs";
const LAYER_NAME = "oversvamning_100ar"; // Layer for 100-year flood risk

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { lat, lng } = await request.json();

  if (!lat || !lng) {
    return json({ error: "Missing coordinates" }, { status: 400 });
  }

  // Konstruera WFS GetFeature-URL med ett CQL-filter för att hitta överlapp
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: LAYER_NAME,
    outputFormat: "application/json",
    srsName: "EPSG:4326", // Begär data i WGS84 för att matcha input
    cql_filter: `INTERSECTS(geom, POINT(${lng} ${lat}))`,
  });

  const requestUrl = `${SMHI_WFS_URL}?${params.toString()}`;

  try {
    const smhiResponse = await fetch(requestUrl);

    if (!smhiResponse.ok) {
      throw new Error(`SMHI WFS request failed with status: ${smhiResponse.status}`);
    }

    const data = await smhiResponse.json();
    const isFlooded = data.features && data.features.length > 0;
    
    return json({ isFlooded, hits: data.features.length, source: "SMHI (Live WFS)" });
  } catch (error) {
    console.error("SMHI audit error:", error);
    return json({ error: "Failed to query SMHI WFS", details: String(error) }, { status: 500 });
  }
}