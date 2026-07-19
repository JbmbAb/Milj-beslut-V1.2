import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { parseBbox, getMarkCoverLayer, getTerrainData, auditInSarRiskAtPoint } from '../modules/gis/public';
import { asBboxTuple } from '../utils/routeUtils';

const router = express.Router();

router.get('/api/geo/markcover', requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    const bboxStr = String(req.query.bbox ?? '');
    const bbox = parseBbox(bboxStr);
    if (!bbox) {
      res.status(400).json({ ok: false, error: 'bbox krävs: minLng,minLat,maxLng,maxLat' });
      return;
    }

    const layer = await getMarkCoverLayer(asBboxTuple(bbox));
    res.json({ ok: true, layer });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/geo/terrain', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const bboxStr = String(req.query.bbox ?? '');
    const bbox = parseBbox(bboxStr);
    if (!bbox) {
      res.status(400).json({ ok: false, error: 'bbox krävs: minLng,minLat,maxLng,maxLat' });
      return;
    }

    const resolutionRaw = parseInt(String(req.query.resolution ?? '32'), 10);
    const resolution = Number.isFinite(resolutionRaw) ? resolutionRaw : 32;

    const terrain = await getTerrainData(asBboxTuple(bbox), resolution);
    res.json({ ok: true, terrain });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/geo/insar', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ ok: false, error: 'Kräver lat och lng som number' });
      return;
    }

    const audit = await auditInSarRiskAtPoint(lat, lng);
    res.json({ ok: true, data: audit });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
