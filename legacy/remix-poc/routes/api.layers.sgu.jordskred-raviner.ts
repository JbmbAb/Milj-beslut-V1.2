import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";

const FEATURE_LIMIT = 1500;
const COVERAGE_MODE = String(process.env.SGU_DB_COVERAGE_MODE || "sample").trim().toLowerCase() === "complete"
  ? "complete"
  : "sample";

type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type LandslideRow = {
  source_key: string;
  feature_code: number | null;
  feature_label: string | null;
  symbol: number | null;
  geojson: string;
};

function parseBbox(rawBbox: string | null): Bbox | null {
  if (!rawBbox) return null;
  const parts = rawBbox.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

function toFeatureCollection(rows: LandslideRow[]) {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      geometry: JSON.parse(row.geojson),
      properties: {
        source_key: row.source_key,
        feature_code: row.feature_code,
        feature_label: row.feature_label,
        symbol: row.symbol,
      },
    })),
    meta: {
      coverageMode: COVERAGE_MODE,
      screeningOnly: true,
      featureLimit: FEATURE_LIMIT,
    },
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const bbox = parseBbox(url.searchParams.get("bbox"));
  if (!bbox) {
    return json({ error: "bbox query parameter is required" }, { status: 400 });
  }

  try {
    const rows = await prisma.$queryRaw<LandslideRow[]>`
      SELECT
        source_key,
        feature_code,
        feature_label,
        symbol,
        ST_AsGeoJSON(
          ST_Transform(
            ST_Simplify(geom, 25),
            4326
          )
        ) AS geojson
      FROM env.sgu_landslide_feature
      WHERE geom && ST_Transform(
        ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
        3006
      )
      AND ST_Intersects(
        geom,
        ST_Transform(
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326),
          3006
        )
      )
      LIMIT ${FEATURE_LIMIT};
    `;

    return json(toFeatureCollection(rows));
  } catch (error) {
    return json({ error: "Failed to fetch SGU jordskred-raviner", details: String(error) }, { status: 500 });
  }
}
