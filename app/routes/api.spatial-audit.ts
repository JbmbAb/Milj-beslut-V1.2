import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { runSpatialAudit } from "~/server/services/spatialAuditService";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { lat, lng } = await request.json();
  if (typeof lat !== "number" || typeof lng !== "number") {
    return json({ error: "Missing coordinates" }, { status: 400 });
  }

  try {
    const result = await runSpatialAudit(lat, lng);
    return json({
      hits: result.protectedAreaHits,
      protectedAreaAvailable: result.protectedAreaAvailable,
      protectedAreaWarning: result.protectedAreaWarning,
      isProtected: result.isProtected,
      sgu: result.sgu,
      text: result.text,
      sources: result.sources,
    });
  } catch (error) {
    console.error("Spatial audit error:", error);
    return json({ error: "Database query failed", details: String(error) }, { status: 500 });
  }
}
