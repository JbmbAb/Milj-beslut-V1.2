import express from 'express';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { prisma } from '../db/prisma';
import {
  parseBbox,
  getProtectedAreaLayer,
  getWaterProtectionLayer,
  getSguGroundLayerLayer,
  getSguWellLayer,
  getHydroLayer,
  getPropertyLayer,
  getTopo10Layer,
} from '../modules/gis/public';
import { parsePositiveInt } from '../utils/routeUtils';

/**
 * Semantiska GeoJSON-endpoints för lokaliseringskartan.
 * Samma data som /api/layers/* men med läsbara path-namn (/api/geodata/soil m.m.).
 */
const router = express.Router();

function featureCollectionFallback(warning: string) {
  return {
    type: 'FeatureCollection' as const,
    features: [] as Array<unknown>,
    meta: {
      source: 'unavailable',
      available: false,
      manualReviewRequired: true,
      warning,
    },
  };
}

router.get('/api/geodata/soil', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }
    const collection = await getSguGroundLayerLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Geodata jordlager kunde inte laddas.')));
  }
});

router.get('/api/geodata/wells', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 2000, 1, 5000);
    const collection = await getSguWellLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Geodata brunnar kunde inte laddas.')));
  }
});

router.get('/api/geodata/lakes', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }
    const collection = await getHydroLayer('lakes', bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res.status(200).json(featureCollectionFallback(String(safe.error || 'Geodata sjoar kunde inte laddas.')));
  }
});

router.get('/api/geodata/streams', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }
    const collection = await getHydroLayer('streams', bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Geodata vattendrag kunde inte laddas.')));
  }
});

router.get('/api/geodata/topo-water', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }
    const collection = await getTopo10Layer(bbox, 'vatten');
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res.status(200).json(featureCollectionFallback(String(safe.error || 'Topo-vatten kunde inte laddas.')));
  }
});

router.get('/api/geodata/topo-buildings', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }
    const collection = await getTopo10Layer(bbox, 'buildings');
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Topo-byggnader kunde inte laddas.')));
  }
});

router.get('/api/geodata/topo-mark', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }
    const collection = await getTopo10Layer(bbox, 'mark');
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res.status(200).json(featureCollectionFallback(String(safe.error || 'Topo-mark kunde inte laddas.')));
  }
});

router.get('/api/geodata/water-protection', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getWaterProtectionLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Geodata vattenskydd kunde inte laddas.')));
  }
});

router.get('/api/geodata/protected-nature', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getProtectedAreaLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Geodata skyddad natur kunde inte laddas.')));
  }
});

router.get('/api/geodata/property', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const lanKodRaw = typeof req.query.lan_kod === 'string' ? Number(req.query.lan_kod) : null;
    const lanKod = Number.isInteger(lanKodRaw) && lanKodRaw >= 1 && lanKodRaw <= 25 ? lanKodRaw : undefined;

    const collection = await getPropertyLayer(bbox, lanKod);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Geodata fastigheter kunde inte laddas.')));
  }
});

router.get('/api/geodata/stats', rateLimitByUser(60, 60_000), async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        skyddade: bigint;
        kulturmiljoer: bigint;
        vatmarker: bigint;
        fastigheter: bigint;
      }>
    >`
      SELECT
        (SELECT count(*) FROM env.protected_area) +
        (SELECT count(*) FROM env.natura2000_area) +
        (SELECT count(*) FROM env.nv_naturreservat) +
        (SELECT count(*) FROM env.water_protection_area) AS skyddade,
        (SELECT count(*) FROM env.byggnadsminnen) +
        (SELECT count(*) FROM env.kulturmiljo_omrade) AS kulturmiljoer,
        (SELECT count(*) FROM env.wetland) AS vatmarker,
        (SELECT count(*) FROM env.registerenhetsomradesytor) AS fastigheter
    `;
    const r = rows[0];
    res.json({
      ok: true,
      skyddadeOmraden: Number(r.skyddade),
      kulturmiljoer: Number(r.kulturmiljoer),
      vatmarker: Number(r.vatmarker),
      fastigheter: Number(r.fastigheter),
    });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
