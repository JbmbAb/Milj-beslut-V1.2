import express from 'express';
import { requireAuth } from '../security/auth';
import { normalizePropertyLookupBody } from '../security/propertyLookupNormalize';
import { rateLimitByUser, rateLimitByOrg } from '../security/rateLimit';
import { SecureError, toSafeErrorResponse } from '../security/secureErrors';
import { lookupPropertyByDesignationFromPostgis } from '../modules/property/public';

const router = express.Router();

/**
 * W-TEXT2 (3; U20CDF6 report 7): the read-fault doctrine on the property lookup too -- the LU UI reads this route and
 * offers "Försök igen" only on the server's own `retryable: true`. Three kinds of failure:
 *  - proven invalid input (the normaliser's and validatePropertyLookupInput's own messages, matched exactly): the
 *    request itself is wrong -> 400, retryable false (unchanged status);
 *  - a failure toSafeErrorResponse recognises as the request's (absence LOCAL_PROPERTY_NOT_FOUND / PROPERTY_NOT_FOUND,
 *    a denial, a typed SecureError below 500 such as PROPERTY_LOOKUP_AMBIGUOUS): the answer this route has always
 *    given (400 with that body), retryable false -- none of them is healed by a retry;
 *  - a typed SecureError of 500 or above: its public message, 503, retryable false (a deliberate server-side refusal
 *    with its own text; nothing is promised);
 *  - anything else thrown while READING (the database, a lock, an unknown error): a read fault of unknown
 *    persistence -> 503, retryable true, a Swedish text that blames neither the request nor the user and carries no
 *    raw message. Before, every failure answered 400 with toSafeErrorResponse's English generic text.
 * No new code and no new field beyond the explicit `retryable`.
 */
const INVALID_INPUT_MESSAGES: ReadonlySet<string> = new Set([
  'Ogiltig begäran: body saknas', // server/security/propertyLookupNormalize.ts normalizePropertyLookupBody
  'projectId, propertyDesignation and purpose are required', // server/security/projectAccess.ts validatePropertyLookupInput
  'Bulk or wildcard property lookup is not allowed', // validatePropertyLookupInput
]);
const PROPERTY_LOOKUP_READ_FAULT_SV =
  'Fastighetsuppslaget kunde inte genomföras på grund av ett tekniskt fel. Ett nytt försök kan lyckas.';

export function propertyLookupFailure(error: unknown): { readonly status: 400 | 503; readonly body: Record<string, unknown> } {
  const { statusCode, ...safe } = toSafeErrorResponse(error);
  const provenInvalidInput = error instanceof Error && INVALID_INPUT_MESSAGES.has(error.message);
  if (provenInvalidInput || (statusCode !== undefined && statusCode < 500)) {
    return { status: 400, body: { ...safe, retryable: false } };
  }
  if (error instanceof SecureError) {
    return { status: 503, body: { ...safe, retryable: false } };
  }
  return { status: 503, body: { ok: false, error: PROPERTY_LOOKUP_READ_FAULT_SV, retryable: true } };
}

function answerLookupFailure(res: express.Response, error: unknown): void {
  const failure = propertyLookupFailure(error);
  res.status(failure.status).json(failure.body);
}

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
        res.status(401).json({ ok: false, error: 'Unauthorized', retryable: false });
        return;
      }
      const input = normalizePropertyLookupBody(req.body);
      const mode = (process.env.PROPERTY_LOOKUP_MODE ?? 'postgis').toLowerCase();

      if (isLiveLookupMode(mode)) {
        // W-TEXT2 (3): a configuration refusal -- retryable false, explicitly.
        res.status(503).json({
          ok: false,
          code: 'LIVE_LANTMATERIET_DISABLED',
          error:
            'Live Lantmäteriet-uppslag är avstängt. UI använder endast lokal PostGIS (PROPERTY_LOOKUP_MODE=postgis).',
          retryable: false,
        });
        return;
      }

      const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
      res.json({ ok: true, result, source: 'postgis' });
    } catch (error: unknown) {
      answerLookupFailure(res, error);
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
        res.status(401).json({ ok: false, error: 'Unauthorized', retryable: false });
        return;
      }
      const input = normalizePropertyLookupBody(req.body);
      const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
      res.json({ ok: true, result });
    } catch (error: unknown) {
      answerLookupFailure(res, error);
    }
  },
);

export default router;
