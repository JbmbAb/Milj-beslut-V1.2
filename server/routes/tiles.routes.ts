import express from 'express';
import { getNmdVectorTile } from '../modules/gis/public';
import { logger } from '../logger';

const router = express.Router();

function parseTileCoordinate(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

router.get('/api/tiles/nmd/:z/:x/:y.pbf', async (req, res) => {
  const z = parseTileCoordinate(req.params.z);
  const x = parseTileCoordinate(req.params.x);
  const y = parseTileCoordinate(req.params.y);

  if (z == null || x == null || y == null) {
    res.status(400).json({ error: 'Ogiltiga tile-koordinater.' });
    return;
  }

  try {
    const tile = await getNmdVectorTile(z, x, y);

    if (!tile || tile.length === 0) {
      res.status(204).end();
      return;
    }

    res.setHeader('Content-Type', 'application/x-protobuf');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(tile);
  } catch (error) {
    logger.error('NMD tile generation failed', {
      z,
      x,
      y,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'NMD-vectorlager kunde inte genereras.' });
  }
});

export default router;
