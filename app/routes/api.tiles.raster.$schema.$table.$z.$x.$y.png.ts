import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from '../../db.server';
import { getLayer } from '../services/layerRegistry';

/**
 * API Route: /api/tiles/raster/:schema/:table/:z/:x/:y.png
 * Serves dynamic Raster Tiles directly from PostGIS.
 * Note: Requires ST_AsPNG and proper colormapping in PostGIS.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { schema, table, z, x, y } = params;

  if (!schema || !table || !z || !x || !y) {
    return new Response("Missing tile parameters", { status: 400 });
  }

  const layerId = `${schema}.${table}`;
  const layer = getLayer(layerId);

  if (!layer || layer.kind !== "raster") {
    return new Response(`Layer ${layerId} not found or not Raster compatible`, { status: 404 });
  }

  const zInt = parseInt(z);
  const xInt = parseInt(x);
  const yInt = parseInt(y.replace(".png", ""));

  try {
    /**
     * PostGIS Raster Tile Generation
     * 1. ST_TileEnvelope: Get the bounding box of the tile
     * 2. ST_ColorMap: (Optional) Map values to colors if needed
     * 3. ST_AsPNG: Convert the resulting raster to PNG format
     */
    const query = `
      WITH tile_bounds AS (
        SELECT ST_Transform(ST_TileEnvelope($1, $2, $3), ST_SRID("${layer.rasterColumn}")) as geom
      ),
      clipped_raster AS (
        SELECT ST_Clip("${layer.rasterColumn}", geom) as rast
        FROM "${layer.schema}"."${layer.table}", tile_bounds
        WHERE ST_Intersects("${layer.rasterColumn}", geom)
      ),
      merged_raster AS (
        SELECT ST_Union(rast) as rast FROM clipped_raster
      )
      SELECT ST_AsPNG(
        ST_Transform(
          ST_Resize(rast, 256, 256), 
          3857
        )
      ) as png
      FROM merged_raster
      WHERE rast IS NOT NULL
    `;

    const result = await prisma.$queryRawUnsafe<Array<{ png: Buffer }>>(
      query,
      zInt,
      xInt,
      yInt
    );

    if (!result || result.length === 0 || !result[0].png) {
      return new Response(null, { status: 204 });
    }

    return new Response(result[0].png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });

  } catch (error) {
    console.error(`Raster Tile Error for ${layerId}:`, error);
    return new Response("Error generating raster tile", { status: 500 });
  }
}
