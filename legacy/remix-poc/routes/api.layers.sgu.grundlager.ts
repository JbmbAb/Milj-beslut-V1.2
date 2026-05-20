import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";

const FEATURE_LIMIT = 1000;
const COVERAGE_MODE = String(process.env.SGU_DB_COVERAGE_MODE || "sample").trim().toLowerCase() === "complete"
  ? "complete"
  : "sample";

type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type GroundLayerRow = {
  source_key: string;
  layer_code: number | null;
  layer_label: string | null;
  map_type: number | null;
  source_scale: string;
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

function toFeatureCollection(rows: GroundLayerRow[]) {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      geometry: JSON.parse(row.geojson),
      properties: {
        source_key: row.source_key,
        layer_code: row.layer_code,
        layer_label: row.layer_label,
        map_type: row.map_type,
        source_scale: row.source_scale,
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
    const rows = await prisma.$queryRaw<GroundLayerRow[]>`
      SELECT
        source_key,
        layer_code,
        layer_label,
        map_type,
        source_scale,
        ST_AsGeoJSON(
          ST_Transform(
            ST_SimplifyPreserveTopology(geom, 100),
            4326
          )
        ) AS geojson
      FROM env.sgu_ground_layer
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
    return json({ error: "Failed to fetch SGU grundlager", details: String(error) }, { status: 500 });
  }
}
