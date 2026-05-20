import type { LoaderFunctionArgs } from '@remix-run/node';
import { prisma } from '../../db.server';
import { getLayer } from '../services/layerRegistry';

/**
 * API Route: /api/tiles/:schema/:table/:z/:x/:y.pbf
 * Serves dynamic Mapbox Vector Tiles (MVT) directly from PostGIS.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { schema, table, z, x, y } = params;

  if (!schema || !table || !z || !x || !y) {
    return new Response('Missing tile parameters', { status: 400 });
  }

  const layerId = `${schema}.${table}`;
  const layer = getLayer(layerId);

  if (!layer || layer.kind !== 'mvt' || !layer.geomColumn) {
    return new Response(`Layer ${layerId} not found, not MVT compatible, or missing geometry column`, {
      status: 404,
    });
  }

  const zInt = parseInt(z);
  const xInt = parseInt(x);
  const yInt = parseInt(y.replace('.pbf', ''));

  try {
    /**
     * PostGIS MVT Generation Query
     * 1. ST_TileEnvelope: Generates the bounding box for the tile in Web Mercator (3857)
     * 2. ST_AsMVTGeom: Transforms and clips the geometry to tile coordinates
     * 3. ST_AsMVT: Aggregates the geometries into a binary Protocol Buffer (PBF)
     */
    const query = `
      WITH mvt_geom AS (
        SELECT
          ST_AsMVTGeom(
            ST_Transform(${layer.geomColumn}, 3857),
            ST_TileEnvelope($1, $2, $3),
            4096,
            64,
            true
          ) AS geom,
          *
        FROM "${layer.schema}"."${layer.table}"
        WHERE "${layer.geomColumn}" && ST_Transform(ST_TileEnvelope($1, $2, $3), 3006)
      )
      SELECT ST_AsMVT(mvt_geom.*, $4, 4096, 'geom') AS mvt
      FROM mvt_geom
    `;

    // Note: We use 3006 in the WHERE clause because our source data is SWEREF99 TM
    // but the output tile must be in 3857 for standard web map clients.

    const result = await prisma.$queryRawUnsafe<Array<{ mvt: Buffer }>>(query, zInt, xInt, yInt, layer.id);

    if (!result || result.length === 0 || !result[0].mvt) {
      // Return 204 No Content for empty tiles (common for sparse layers)
      return new Response(null, { status: 204 });
    }

    return new Response(result[0].mvt, {
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error(`MVT Error for ${layerId}:`, error);
    return new Response('Internal Server Error during tile generation', { status: 500 });
  }
}
