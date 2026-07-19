import { prisma } from '../../db/prisma';
import { LayerConfig } from './layerConfig.js';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

// Initialize LRU cache for vector tiles
const tileCache = new LRUCache<string, Buffer>({
  max: 10000, // Maximum number of tiles to keep in memory
  ttl: 1000 * 60 * 60 * 24, // 24 hours
  maxSize: 500 * 1024 * 1024, // 500MB max memory
  sizeCalculation: (value) => {
    return value.length;
  }
});

/**
 * Generates an ETag for the buffer
 */
export function generateETag(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Generates a Mapbox Vector Tile (MVT) for the given layer configuration and XYZ coordinates.
 */
export async function getVectorTile(
  layer: LayerConfig,
  z: number,
  x: number,
  y: number
): Promise<{ buffer: Buffer; etag: string } | null> {
  // Enforce zoom limits
  if (z < layer.minZoom || z > layer.maxZoom) {
    return null;
  }

  const cacheKey = `tile:${layer.table}:${z}:${x}:${y}`;
  const cachedTile = tileCache.get(cacheKey);

  if (cachedTile) {
    return { buffer: cachedTile, etag: generateETag(cachedTile) };
  }

  // Build the dynamic SQL query
  let geomExpr = `t.${layer.geomColumn}`;
  
  // Apply ST_SimplifyPreserveTopology if configured and zoom is below threshold
  if (layer.simplifyZoom && layer.simplifyTolerance && z < layer.simplifyZoom) {
    geomExpr = `ST_SimplifyPreserveTopology(${geomExpr}, ${layer.simplifyTolerance})`;
  }

  // Construct property selection
  let propertiesSelect = '';
  if (layer.properties && layer.properties.length > 0) {
    propertiesSelect = `, ` + layer.properties.map(p => `t.${p}`).join(', ');
  } else if (layer.idColumn) {
    propertiesSelect = `, t.${layer.idColumn}`;
  }

  const query = `
    WITH bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    ),
    mvtgeom AS (
      SELECT
        ST_AsMVTGeom(
          ${geomExpr},
          bounds.geom,
          4096,
          64,
          true
        ) AS geom
        ${propertiesSelect}
      FROM
        ${layer.schema}.${layer.table} t,
        bounds
      WHERE
        t.${layer.geomColumn} && bounds.geom
        AND ST_Intersects(t.${layer.geomColumn}, bounds.geom)
    )
    SELECT ST_AsMVT(mvtgeom.*, $4, 4096, 'geom') AS tile
    FROM mvtgeom;
  `;

  try {
    const result = await prisma.$queryRawUnsafe<Array<{ tile: Buffer | null }>>(
      query, 
      z, x, y
    );
    
    if (result.length === 0 || !result[0].tile) {
      return null;
    }

    const tileBuffer = result[0].tile;
    
    // Cache only if tile is not empty
    if (tileBuffer.length > 0) {
      tileCache.set(cacheKey, tileBuffer);
      return { buffer: tileBuffer, etag: generateETag(tileBuffer) };
    }

    return null;
  } catch (error) {
    console.error(`Error generating tile for ${layer.table} at ${z}/${x}/${y}:`, error);
    throw error;
  }
}
