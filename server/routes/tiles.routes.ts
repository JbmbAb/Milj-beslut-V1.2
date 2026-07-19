import express from 'express';
import { logger } from '../logger.js';
import { layers } from '../modules/gis/layerConfig.js';
import { getVectorTile } from '../modules/gis/vectorTileEngine.js';

const router = express.Router();

function parseTileCoordinate(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Metadata API
router.get('/api/tiles/metadata', (req, res) => {
  // Strip away internal DB config (schema, table, columns) for the client
  const metadata = Object.entries(layers).map(([id, config]) => ({
    id,
    minZoom: config.minZoom,
    maxZoom: config.maxZoom,
    style: config.style,
  }));
  
  res.json(metadata);
});

// Generic Tile Route
router.get('/api/tiles/:layer/:z/:x/:y.pbf', async (req, res) => {
  const { layer } = req.params;
  const z = parseTileCoordinate(req.params.z);
  const x = parseTileCoordinate(req.params.x);
  const y = parseTileCoordinate(req.params.y);

  if (z == null || x == null || y == null) {
    res.status(400).json({ error: 'Ogiltiga tile-koordinater.' });
    return;
  }

  const config = layers[layer];
  if (!config) {
    res.status(404).json({ error: 'Lagret hittades inte.' });
    return;
  }

  try {
    const tileResult = await getVectorTile(config, z, x, y);

    if (!tileResult || !tileResult.buffer || tileResult.buffer.length === 0) {
      res.status(204).end();
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    res.setHeader('ETag', `"${tileResult.etag}"`);
    
    // Check if client supports gzip. If we have a global compression middleware, 
    // it usually handles it, but since we are serving raw buffers, compression middleware 
    // often ignores them unless they are strings or we explicitly compress. 
    // Let's rely on Express compression middleware which we'll add to app.ts.
    
    res.status(200).send(tileResult.buffer);
  } catch (error) {
    logger.error(`Tile generation failed for ${layer}`, {
      z, x, y,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Vectorlager kunde inte genereras.' });
  }
});

export default router;
