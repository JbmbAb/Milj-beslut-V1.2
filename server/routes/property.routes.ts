import express from 'express';
import { requireAuth } from '../security/auth';
import { normalizePropertyLookupBody } from '../security/propertyLookupNormalize';
import { rateLimitByUser, rateLimitByOrg } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { lookupPropertyByDesignationFromPostgis } from '../modules/property/public';

const router = express.Router();

/**
 * Fastighetsuppslag — Mimers Brunn / offline-first / local-only UI.
 *
 * PROPERTY_LOOKUP_MODE:
 *   - "postgis" (default) — endast PostGIS (core.property_unit)
 *   - "hybrid"            — alias för postgis (bakåtkompatibilitet)
 *   - "live" / "api"      — DISABLED: returnerar 503 (inga live-anrop till Lantmäteriet)
 */
function isLiveLookupMode(mode: string): boolean {
  return mode === 'live' || mode === 'api';
}

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
      const mode = (process.env.PROPERTY_LOOKUP_MODE ?? 'postgis').toLowerCase();

      if (isLiveLookupMode(mode)) {
        res.status(503).json({
          ok: false,
          code: 'LIVE_LANTMATERIET_DISABLED',
          error:
            'Live Lantmäteriet-uppslag är avstängt. UI använder endast lokal PostGIS (PROPERTY_LOOKUP_MODE=postgis).',
        });
        return;
      }

      const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
      res.json({ ok: true, result, source: 'postgis' });
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
