import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from '../../db.server';
import { getLayer } from '../services/layerRegistry';
import { LRUCache } from 'lru-cache';

// Initialize LRU cache for raster PNG tiles (100MB max size)
const rasterCache = new LRUCache<string, Buffer>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 12, // 12 hours
  maxSize: 100 * 1024 * 1024,
  sizeCalculation: (value) => value.length,
});

const NMD_COLORMAP = `
3 229 229 0 255
23 0 100 0 255
43 0 80 0 255
51 220 20 20 255
52 169 169 169 255
53 100 100 100 255
54 139 69 19 255
61 30 144 255 255
62 20 100 240 255
111 0 100 0 255
112 0 100 0 255
113 0 100 0 255
114 0 100 0 255
115 50 205 50 255
116 50 205 50 255
117 50 205 50 255
118 107 142 35 255
121 0 80 0 255
122 0 80 0 255
123 0 80 0 255
124 0 80 0 255
125 40 180 40 255
126 40 180 40 255
127 40 180 40 255
128 90 120 30 255
200 138 43 226 255
211 138 43 226 255
212 138 43 226 255
213 138 43 226 255
214 138 43 226 255
215 138 43 226 255
216 138 43 226 255
217 138 43 226 255
218 138 43 226 255
221 138 43 226 255
222 138 43 226 255
223 138 43 226 255
224 138 43 226 255
225 138 43 226 255
226 138 43 226 255
227 138 43 226 255
228 138 43 226 255
230 138 43 226 255
411 222 184 135 255
412 240 248 255 255
413 255 250 250 255
4211 205 133 63 255
4212 205 133 63 255
4213 205 133 63 255
4221 210 180 140 255
4222 210 180 140 255
4223 210 180 140 255
4231 244 164 96 255
4232 244 164 96 255
4233 244 164 96 255
nv 0 0 0 0
`;

/**
 * API Route: /api/tiles/raster/:schema/:table/:z/:x/:y.png
 * Serves dynamic Raster Tiles directly from PostGIS.
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

  const cacheKey = `${layerId}:${zInt}:${xInt}:${yInt}`;
  const cachedPng = rasterCache.get(cacheKey);
  if (cachedPng) {
    return new Response(cachedPng, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
      },
    });
  }

  const isNmd = table.toLowerCase().includes("nmd") || table.toLowerCase().includes("marktacke");

  try {
    let query: string;
    let queryArgs: any[];

    if (isNmd) {
      query = `
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
          ST_ColorMap(
            ST_Transform(
              ST_Resize(rast, 256, 256), 
              3857
            ),
            1,
            $4
          )
        ) as png
        FROM merged_raster
        WHERE rast IS NOT NULL
      `;
      queryArgs = [zInt, xInt, yInt, NMD_COLORMAP];
    } else {
      query = `
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
      queryArgs = [zInt, xInt, yInt];
    }

    const result = await prisma.$queryRawUnsafe<Array<{ png: Buffer }>>(
      query,
      ...queryArgs
    );

    if (!result || result.length === 0 || !result[0].png) {
      return new Response(null, { status: 204 });
    }

    const pngBuffer = result[0].png;
    rasterCache.set(cacheKey, pngBuffer);

    return new Response(pngBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
      },
    });

  } catch (error) {
    console.error(`Raster Tile Error for ${layerId}:`, error);
    return new Response("Error generating raster tile", { status: 500 });
  }
}
