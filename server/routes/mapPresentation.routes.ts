import express from 'express';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { logger } from '../logger';
import {
  buildPropertyViewportPresentation,
  MAP_PRESENTATION_MAX_FEATURES,
  parseViewportBbox,
} from '../modules/map-presentation/mapPresentationService';

const router = express.Router();

/**
 * GET /api/map/presentation/viewport
 * Smallest Cesium presentation product: viewport-bounded property read-model features.
 * Client must not expand query authority — server enforces bbox span + feature limit.
 */
router.get('/api/map/presentation/viewport', rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseViewportBbox(rawBbox);
    if (!bbox || !rawBbox) {
      res.status(400).json({
        error:
          'bbox is required as minLng,minLat,maxLng,maxLat (WGS84) and must be within the presentation span cap',
      });
      return;
    }

    const layer = typeof req.query.layer === 'string' ? req.query.layer : 'property';
    if (layer !== 'property') {
      res.status(400).json({
        error: `Unsupported presentation layer '${layer}'. Only 'property' is admitted in map-viewport-v1.`,
      });
      return;
    }

    const sourceRaw = typeof req.query.source === 'string' ? req.query.source : 'live';
    if (sourceRaw !== 'live' && sourceRaw !== 'fixture') {
      res.status(400).json({ error: "source must be 'live' or 'fixture' (explicit; no silent fallback)" });
      return;
    }

    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : MAP_PRESENTATION_MAX_FEATURES;
    const limit = Number.isFinite(limitRaw) ? limitRaw : MAP_PRESENTATION_MAX_FEATURES;

    const collection = await buildPropertyViewportPresentation({
      bbox,
      bboxRaw: rawBbox,
      limit,
      source: sourceRaw,
    });
    res.json(collection);
  } catch (error: unknown) {
    logger.error('[API Map Presentation Viewport] Error:', error);
    res.status(500).json(toSafeErrorResponse(error));
  }
});

/**
 * GET /api/map/presentation/registry
 * Presentation config only — not dataset authority.
 */
router.get('/api/map/presentation/registry', rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({
    ok: true,
    presentation: 'map-viewport-v1',
    layers: [
      {
        layer_id: 'property',
        presentation: 'geojson_entities',
        client_status: 'READY',
        endpoint: '/api/map/presentation/viewport?layer=property',
      },
      {
        layer_id: 'buildings',
        presentation: '3d_tiles',
        client_status: 'READY',
        note: 'BUILDING CLIENT COMPLETE / REAL NATIONAL DATA PENDING',
        local_fixture: '/cesium/fixtures/tilesets/buildings/tileset.json',
      },
      {
        layer_id: 'orthophoto',
        presentation: 'imagery_tiles',
        client_status: 'READY',
        local_fixture: '/cesium/fixtures/imagery/orthophoto/{z}/{x}/{y}.png',
      },
      {
        layer_id: 'topographic',
        presentation: 'imagery_tiles',
        client_status: 'READY',
        local_fixture: '/cesium/fixtures/imagery/topographic/{z}/{x}/{y}.png',
      },
      {
        layer_id: 'terrain',
        presentation: 'terrain_tiles',
        client_status: 'READY',
        note: 'Ellipsoid fallback + local fixture provenance seam',
      },
      { layer_id: 'land_cover', presentation: 'registration_seam_only', client_status: 'SEAM_ONLY' },
      { layer_id: 'topography_vectors', presentation: 'registration_seam_only', client_status: 'SEAM_ONLY' },
      { layer_id: 'hydrography', presentation: 'registration_seam_only', client_status: 'SEAM_ONLY' },
    ],
    height_contract: 'cesium.height-reference.v0',
    authority: 'Cesium is NEVER Decision Authority. PostGIS computes spatial evidence.',
  });
});

export default router;
