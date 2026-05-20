import express from 'express';
import { logger } from '../logger';
import { requireAuth } from '../security/auth';
import { normalizePropertyLookupBody } from '../security/propertyLookupNormalize';
import { rateLimitByUser, rateLimitByOrg } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  lookupPropertyByDesignation,
  lookupPropertyByDesignationFromPostgis,
} from '../modules/property/public';

const router = express.Router();

// Hybrid property-lookup: PostGIS först (lokal och snabb), därefter avgiftsfri
// OGC med prenumerationsnyckel, sist OAuth/betalda Lantmäteriet-produkter (i lookupPropertyByDesignation).
// Styrs av PROPERTY_LOOKUP_MODE:
//   - "hybrid" (default) — PostGIS → öppen OGC → betalt live
//   - "postgis"          — endast PostGIS
//   - "live"             — endast Lantmäteriet live (öppen OGC före OAuth i tjänsten)
router.post(
  '/api/property/lookup',
  requireAuth,
  rateLimitByUser(30, 5 * 60_000),
  rateLimitByOrg(200, 60 * 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const input = normalizePropertyLookupBody(req.body);
      const mode = (process.env.PROPERTY_LOOKUP_MODE ?? 'hybrid').toLowerCase();

      if (mode === 'live') {
        const result = await lookupPropertyByDesignation(input, req.authUser);
        res.json({ ok: true, result, source: 'live' });
        return;
      }

      if (mode === 'postgis') {
        const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
        res.json({ ok: true, result, source: 'postgis' });
        return;
      }

      // hybrid (default) — PostGIS först, sedan öppen OGC / betalt (se lantmaterietService).
      try {
        const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
        if (result) {
          res.json({ ok: true, result, source: 'postgis' });
          return;
        }
      } catch (err) {
        logger.info('property-lookup: PostGIS miss, försöker live', {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      const liveResult = await lookupPropertyByDesignation(input, req.authUser);
      const fallbackSource =
        typeof liveResult?.source === 'string' && liveResult.source === 'open-ogc'
          ? 'open-ogc-fallback'
          : 'live-fallback';
      res.json({ ok: true, result: liveResult, source: fallbackSource });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/property/lookup/postgis',
  requireAuth,
  rateLimitByUser(30, 5 * 60_000),
  rateLimitByOrg(200, 60 * 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      const input = normalizePropertyLookupBody(req.body);
      const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
      res.json({ ok: true, result });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
