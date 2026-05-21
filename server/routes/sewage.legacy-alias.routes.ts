/**
 * Legacy UI-paths → canonical orchestrator (/api/sewage/application/*)
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  createSewageApplicationRecord,
  getSewageApplicationById,
  assertSewageApplicationOrgAccess,
} from '../repositories/sewageApplicationRepository';
import type { OrchestratorAuth } from '../modules/sewage/applicationOrchestrator';
import {
  generateDocumentsForApplication,
  recordNeighborConsent,
  recordSoilTest,
  submitSewageApplication,
  validateSewageApplication,
} from '../modules/sewage/applicationOrchestrator';

const router = Router();

const SWEDEN_LAT_MIN = 55.0;
const SWEDEN_LAT_MAX = 69.5;
const SWEDEN_LON_MIN = 10.0;
const SWEDEN_LON_MAX = 25.5;

function isWithinSweden(lat: number, lon: number): boolean {
  return lat >= SWEDEN_LAT_MIN && lat <= SWEDEN_LAT_MAX && lon >= SWEDEN_LON_MIN && lon <= SWEDEN_LON_MAX;
}

/** POST /api/sewage/application/create — wrapper för portal-hook */
router.post('/api/sewage/application/create', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const body = req.body as {
      projectId?: string;
      propertyDesignation?: string;
      municipalityCode?: string;
      pe?: number;
      gisAnalysis?: unknown;
      protectionProfile?: unknown;
    };

    const propertyDesignation =
      body.propertyDesignation ?? (body as { propertyAddress?: string }).propertyAddress;
    if (!propertyDesignation) {
      res.status(400).json({ ok: false, error: 'propertyDesignation required' });
      return;
    }

    const lat = (body.gisAnalysis as { coordinates?: { lat?: number } })?.coordinates?.lat ?? 59.33;
    const lng = (body.gisAnalysis as { coordinates?: { lng?: number } })?.coordinates?.lng ?? 18.07;

    if (!isWithinSweden(lat, lng)) {
      res.status(422).json({ ok: false, error: 'coordinates_outside_sweden' });
      return;
    }

    const record = createSewageApplicationRecord({
      organisationId: req.authUser.organisationId,
      createdByUserId: req.authUser.id,
      propertyDesignation,
      latitude: lat,
      longitude: lng,
      applicantName: req.authUser.id,
      applicantEmail: `${req.authUser.id}@miljobeslut.local`,
      systemType:
        (body.protectionProfile as { recommendedSystem?: string })?.recommendedSystem ?? 'INFILTRATION',
      projectId: body.projectId,
      municipalityCode: body.municipalityCode,
      pe: body.pe,
      domainSnapshot: {
        protectionProfile: body.protectionProfile as never,
        gisAnalysis: body.gisAnalysis as never,
      },
    });

    res.status(201).json({ ok: true, application: record });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

async function accessCheck(id: string, authUser: OrchestratorAuth) {
  const record = await getSewageApplicationById(id);
  if (!record) return { record: null, status: 404 as const };
  if (!assertSewageApplicationOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { record: null, status: 403 as const };
  }
  return { record, status: 200 as const };
}

router.post(
  '/api/sewage/application/:id/validate',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id ?? '');
    const access = await accessCheck(id, authUser);
    if (!access.record) {
      res.status(access.status).json({ ok: false, error: access.status === 403 ? 'forbidden' : 'not_found' });
      return;
    }
    const result = await validateSewageApplication(id, req.body);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, canSubmit: result.canSubmit, blockers: result.blockers, warnings: result.warnings });
  },
);

router.post(
  '/api/sewage/application/:id/generate-documents',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id ?? '');
    const access = await accessCheck(id, authUser);
    if (!access.record) {
      res.status(access.status).json({ ok: false, error: access.status === 403 ? 'forbidden' : 'not_found' });
      return;
    }
    const result = await generateDocumentsForApplication(id, req.body);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    res.json({
      ok: true,
      situationPlanSVG: result.situationPlanSVG,
      crossSectionSVG: result.crossSectionSVG,
      generatedAt: result.generatedAt,
      warnings: result.warnings,
    });
  },
);

router.post(
  '/api/sewage/application/:id/submit',
  requireAuth,
  rateLimitByUser(10, 60_000),
  async (req, res) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id ?? '');
    const access = await accessCheck(id, authUser);
    if (!access.record) {
      res.status(access.status).json({ ok: false, error: access.status === 403 ? 'forbidden' : 'not_found' });
      return;
    }

    const parsed = z
      .object({
        municipalityCode: z.string().min(1),
        application: z.unknown().optional(),
        protectionProfile: z.unknown().optional(),
        gisAnalysis: z.unknown().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'municipalityCode required' });
      return;
    }

    const result = await submitSewageApplication(id, authUser, {
      municipalityCode: parsed.data.municipalityCode,
      projectId: access.record.projectId,
      application: parsed.data.application as never,
      protectionProfile: parsed.data.protectionProfile as never,
      gisAnalysis: parsed.data.gisAnalysis as never,
    });

    if (!result.ok) {
      res
        .status(result.status)
        .json({ ok: false, error: result.error, message: 'message' in result ? result.message : undefined });
      return;
    }

    res.json({
      ok: true,
      referenceNumber: result.referenceNumber,
      application: result.application,
    });
  },
);

router.post(
  '/api/sewage/application/:id/update-soil-test',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id ?? '');
    const access = await accessCheck(id, authUser);
    if (!access.record) {
      res.status(access.status).json({ ok: false, error: access.status === 403 ? 'forbidden' : 'not_found' });
      return;
    }
    const input = z
      .object({ ltar: z.number().finite().positive(), testDate: z.string().min(1) })
      .parse(req.body);
    const result = await recordSoilTest(id, { ltar: input.ltar, testDate: input.testDate });
    res.json({ ok: true, application: result.application });
  },
);

router.post(
  '/api/sewage/application/:id/record-neighbor-consent',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id ?? '');
    const access = await accessCheck(id, authUser);
    if (!access.record) {
      res.status(access.status).json({ ok: false, error: access.status === 403 ? 'forbidden' : 'not_found' });
      return;
    }
    const input = z
      .object({
        neighborAddress: z.string().optional(),
        address: z.string().optional(),
        distance: z.number().finite(),
      })
      .parse(req.body);
    const result = await recordNeighborConsent(id, {
      address: input.neighborAddress ?? input.address ?? 'Granne',
      distance: input.distance,
    });
    res.json({ ok: true, application: result.application });
  },
);

export default router;
