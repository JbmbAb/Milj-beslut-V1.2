/**
 * API Routes for Localization Studies (Lokaliseringsutredning)
 */

import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  buildLocalizationPdfData,
  exportLocalizationPdf,
  fetchLocalizationAuditTrail,
  LocalizationDataUnavailableError,
  runLocalizationReport,
  resolveLuViewerPresentation,
  generateLocalizationReportLegacy,
  type SiteAlternative,
} from '../modules/localization/public';

const router = express.Router();

function handleOrchestratorError(error: unknown, res: express.Response): boolean {
  if (error instanceof LocalizationDataUnavailableError) {
    res.status(503).json({
      ok: false,
      error: error.message,
      code: error.code,
    });
    return true;
  }
  return false;
}

/**
 * POST /api/localization/generate-report
 */
router.post(
  '/api/localization/generate-report',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res, next) => {
    try {
      const result = await runLocalizationReport({
        authUser: req.authUser!,
        projectId: String(req.body?.projectId || ''),
        siteAlternatives: req.body?.siteAlternatives,
      });
      if (result.ok === false) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      res.status(200).json({
        ok: true,
        meta: result.meta,
        ...result.report,
      });
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      next(error);
    }
  },
);

/**
 * POST /api/localization/generate-pdf-data
 */
router.post(
  '/api/localization/generate-pdf-data',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res, next) => {
    try {
      const result = await runLocalizationReport({
        authUser: req.authUser!,
        projectId: String(req.body?.projectId || ''),
        siteAlternatives: req.body?.siteAlternatives,
      });
      if (result.ok === false) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      const pdfData = buildLocalizationPdfData(result.report);
      res.status(200).json({ ok: true, pdfData, meta: result.meta });
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      next(error);
    }
  },
);

/**
 * POST /api/localization/export-pdf
 */
router.post(
  '/api/localization/export-pdf',
  requireAuth,
  rateLimitByUser(15, 60_000),
  async (req, res, next) => {
    try {
      const result = await exportLocalizationPdf({
        authUser: req.authUser!,
        projectId: String(req.body?.projectId || ''),
        siteAlternatives: req.body?.siteAlternatives,
      });
      if (result.ok === false) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.buffer);
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      next(error);
    }
  },
);

/**
 * GET /api/localization/:projectId/audit-trail
 */
router.get(
  '/api/localization/:projectId/audit-trail',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, _next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      if (!projectId) {
        res.status(400).json({ ok: false, error: 'projectId required' });
        return;
      }
      const payload = await fetchLocalizationAuditTrail(projectId);
      res.status(200).json(payload);
    } catch (error) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

/**
 * GET /api/localization/:projectId/viewer/evidence
 *
 * P3-LU-CESIUM-PRESENTATION-WIRING-01. The canonical governed LU presentation endpoint --
 * authenticated project access -> current ProjectContextBinding -> current assessment
 * projection -> verified, non-superseded ViewerCapability -> CAS -> ViewerKernel. This is NOT
 * a replacement for /api/spatial/evidence (which remains available for unrelated general GIS
 * exploration); it is the only endpoint the LU product Cesium flow may call.
 */
router.get(
  '/api/localization/:projectId/viewer/evidence',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req, res, next) => {
    try {
      const result = await resolveLuViewerPresentation({
        authUser: req.authUser!,
        projectId: String(req.params.projectId || ''),
      });
      if (result.ok === false) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      res.status(200).json(result.geojson);
    } catch (error) {
      if (handleOrchestratorError(error, res)) return;
      next(error);
    }
  },
);

/** Legacy shape kept for internal scripts — prefer orchestrator routes above. */
export async function generateLocalizationReportRouteHandler(
  projectId: string,
  siteAlternatives: SiteAlternative[],
  userId?: string,
) {
  return generateLocalizationReportLegacy(projectId, siteAlternatives, userId);
}

export default router;
