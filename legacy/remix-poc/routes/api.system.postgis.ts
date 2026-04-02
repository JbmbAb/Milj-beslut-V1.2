import { json } from "@remix-run/node";
import { prisma } from "~/db.server";

export async function loader() {
  try {
    // Försök hämta versionssträngen från PostGIS via Prisma
    // Detta testar både databasanslutningen och att extensionen är aktiv
    const result: any[] = await prisma.$queryRaw`SELECT postgis_full_version()`;
    
    return json({
      ok: true,
      version: result[0]?.postgis_full_version,
      message: "✅ PostGIS är korrekt installerat och svarar."
    });
  } catch (error) {
    console.error("PostGIS check failed:", error);
    return json({
      ok: false,
      message: "❌ PostGIS verkar saknas eller databasen är inte konfigurerad.",
      details: String(error)
    }, { status: 500 });
  }
}