import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../security/auth';
import { assertProjectAccess } from '../security/projectAccess';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  auditTrail,
  assertSewageApplicationOrgAccess,
  getSewageApplicationById,
  updateSewageApplicationRecord,
  type SewageApplicationRecord,
  type SewageApplicationStatus,
  createSewageApplication,
} from '../modules/sewage/public';
import {
  generateDocumentsForApplication,
  getApplicationAuditTrail,
  getApplicationStatusHistory,
  patchApplicationDraft,
  submitSewageApplication,
  validateSewageApplication,
} from '../modules/sewage/applicationOrchestrator';
import { generateSewageDossierPdf } from '../modules/sewage/public';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const router = Router();

// --- Recovered definitions ---
import type { Response } from 'express';

const createApplicationSchema = z.object({
  propertyDesignation: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  applicantName: z.string().min(1),
  applicantEmail: z.string().email(),
  systemType: z.string().min(1),
  projectId: z.string().optional(),
  municipalityCode: z.string().optional(),
  pe: z.number().optional(),
});

const updateApplicationSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  projectId: z.string().optional(),
});

const statusPatchSchema = z.object({
  status: z.string().min(1),
  decisionNote: z.string().optional(),
});

function isWithinSweden(lat: number, lon: number): boolean {
  return lat >= 55.0 && lat <= 69.1 && lon >= 10.5 && lon <= 24.2;
}

function toPublicApplication(record: any) {
  if (!record) return null;
  return record;
}

async function loadRecordOr404(id: string, res: Response) {
  const record = await getSewageApplicationById(id);
  if (!record) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return null;
  }
  return record;
}

function requireApplicationAccess(record: any, authUser: any): boolean {
  return record.organisationId === authUser.organisationId;
}
// ----------------------------

router.get(
  '/api/sewage/applications/:id/dossier',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id ?? '');
      const record = await loadRecordOr404(id, res);
      if (!record) return;
      if (!requireApplicationAccess(record, req.authUser)) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      const tempPath = path.join(os.tmpdir(), `sewage-dossier-${id}-${Date.now()}.pdf`);
      await generateSewageDossierPdf(record, tempPath);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="dossier-avlopp-${record.propertyDesignation.replace(/\s+/g, '-')}.pdf"`,
      );

      const stream = fs.createReadStream(tempPath);
      stream.pipe(res);

      stream.on('end', () => {
        fs.unlink(tempPath, (err) => {
          if (err) console.error('Failed to delete temp dossier PDF:', err);
        });
      });

      await auditTrail.logAction(
        record.referenceNumber,
        'DATA_EXPORTED',
        'SewageApplication',
        record.id,
        req.authUser.id,
        'Export av PDF-dossier',
        { userRole: req.authUser.role, ipAddress: req.ip },
      );
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

// ... (rest of existing routes)
router.post('/api/sewage/applications', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const input = createApplicationSchema.parse(req.body);

    if (!isWithinSweden(input.latitude, input.longitude)) {
      res.status(422).json({
        ok: false,
        error: 'coordinates_outside_sweden',
        message: 'Koordinater måste ligga inom Sverige.',
      });
      return;
    }

    if (input.projectId) {
      await assertProjectAccess(req.authUser, input.projectId, req.authUser.organisationId);
    }

    const record = await createSewageApplication({
      organisationId: req.authUser.organisationId,
      createdByUserId: req.authUser.id,
      propertyDesignation: input.propertyDesignation.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      applicantName: input.applicantName.trim(),
      applicantEmail: input.applicantEmail.trim(),
      systemType: input.systemType,
      projectId: input.projectId,
      municipalityCode: input.municipalityCode,
      pe: input.pe,
    });

    await auditTrail.logAction(
      record.referenceNumber,
      'APPLICATION_CREATED',
      'SewageApplication',
      record.id,
      req.authUser.id,
      `Ansökan skapad för ${record.propertyDesignation}`,
      {
        userRole: req.authUser.role,
        status: record.status,
        systemType: record.systemType,
        ipAddress: req.ip,
      },
    );

    res.status(201).json({ ok: true, application: toPublicApplication(record) });
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res.status(safe.statusCode === 500 ? 400 : (safe.statusCode ?? 400)).json(safe);
  }
});

router.get('/api/sewage/applications/:id', requireAuth, async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const record = await loadRecordOr404(String(req.params.id ?? ''), res);
    if (!record) return;
    if (!requireApplicationAccess(record, req.authUser)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    res.json({ ok: true, application: toPublicApplication(record) });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.patch('/api/sewage/applications/:id', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const id = String(req.params.id ?? '');
    const record = await loadRecordOr404(id, res);
    if (!record) return;
    if (!requireApplicationAccess(record, req.authUser)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    const patch = updateApplicationSchema.parse(req.body);
    if (patch.latitude !== undefined && patch.longitude !== undefined) {
      if (!isWithinSweden(patch.latitude, patch.longitude)) {
        res.status(422).json({ ok: false, error: 'coordinates_outside_sweden' });
        return;
      }
    }
    if (patch.projectId) {
      await assertProjectAccess(req.authUser, patch.projectId, req.authUser.organisationId);
    }

    const result = await patchApplicationDraft(id, patch);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }

    res.json({ ok: true, application: toPublicApplication(result.application) });
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res.status(safe.statusCode === 500 ? 400 : (safe.statusCode ?? 400)).json(safe);
  }
});

router.post(
  '/api/sewage/applications/:id/validate',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id ?? '');
      const record = await loadRecordOr404(id, res);
      if (!record) return;
      if (!requireApplicationAccess(record, req.authUser)) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      const result = await validateSewageApplication(id, req.body);
      if (!result.ok) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }

      await auditTrail.logAction(
        record.referenceNumber,
        'APPLICATION_UPDATED',
        'SewageApplication',
        id,
        req.authUser.id,
        'Validering utförd',
        { ipAddress: req.ip, details: { canSubmit: result.canSubmit } },
      );

      res.json({
        ok: true,
        canSubmit: result.canSubmit,
        blockers: result.blockers,
        warnings: result.warnings,
      });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/sewage/applications/:id/generate-documents',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id ?? '');
      const record = await loadRecordOr404(id, res);
      if (!record) return;
      if (!requireApplicationAccess(record, req.authUser)) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      const result = await generateDocumentsForApplication(id, req.body);
      if (!result.ok) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }

      await auditTrail.logAction(
        record.referenceNumber,
        'DOCUMENTS_GENERATED',
        'SewageApplication',
        id,
        req.authUser.id,
        'Dokument genererade',
        { ipAddress: req.ip },
      );

      res.json({
        ok: true,
        situationPlanSVG: result.situationPlanSVG,
        crossSectionSVG: result.crossSectionSVG,
        generatedAt: result.generatedAt,
        warnings: result.warnings,
      });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/sewage/applications/:id/submit',
  requireAuth,
  rateLimitByUser(10, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id ?? '');
      const record = await loadRecordOr404(id, res);
      if (!record) return;
      if (!requireApplicationAccess(record, req.authUser)) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      const body = z
        .object({
          municipalityCode: z.string().min(1),
          projectId: z.string().optional(),
          application: z.unknown().optional(),
          protectionProfile: z.unknown().optional(),
          gisAnalysis: z.unknown().optional(),
          situationPlanSVG: z.string().optional(),
          crossSectionSVG: z.string().optional(),
        })
        .parse(req.body);

      if (body.projectId) {
        await assertProjectAccess(req.authUser, body.projectId, req.authUser.organisationId);
      }

      const result = await submitSewageApplication(id, req.authUser, {
        municipalityCode: body.municipalityCode,
        projectId: body.projectId,
        application: body.application as Parameters<typeof submitSewageApplication>[2]['application'],
        protectionProfile: body.protectionProfile as Parameters<
          typeof submitSewageApplication
        >[2]['protectionProfile'],
        gisAnalysis: body.gisAnalysis as Parameters<typeof submitSewageApplication>[2]['gisAnalysis'],
        situationPlanSVG: body.situationPlanSVG,
        crossSectionSVG: body.crossSectionSVG,
      });
      if (!result.ok) {
        res.status(result.status).json({
          ok: false,
          error: result.error,
          message: 'message' in result ? result.message : undefined,
          blockers: 'blockers' in result ? result.blockers : undefined,
        });
        return;
      }

      await auditTrail.logSubmission(result.referenceNumber, id, req.authUser.id, result.municipalityCode, [
        'situationPlan',
        'crossSection',
      ]);

      res.json({
        ok: true,
        referenceNumber: result.referenceNumber,
        municipalityCode: result.municipalityCode,
        municipalityEmail: result.municipalityEmail,
        estimatedProcessingWeeks: result.estimatedProcessingWeeks,
        submittedAt: result.submittedAt,
        application: toPublicApplication(result.application ?? null),
        warnings: result.warnings,
      });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.patch(
  '/api/sewage/applications/:id/status',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id ?? '');
      const record = await loadRecordOr404(id, res);
      if (!record) return;
      if (!requireApplicationAccess(record, req.authUser)) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      const patch = statusPatchSchema.parse(req.body);
      const oldStatus = record.status;
      const updated = await updateSewageApplicationRecord(id, {
        status: patch.status as SewageApplicationStatus,
        decisionNote: patch.decisionNote,
      });
      if (!updated) {
        res.status(404).json({ ok: false, error: 'not_found' });
        return;
      }

      await auditTrail.logAction(
        updated.referenceNumber,
        'APPLICATION_UPDATED',
        'SewageApplication',
        updated.id,
        req.authUser.id,
        `Status ändrad från ${oldStatus} till ${updated.status}`,
        {
          userRole: req.authUser.role,
          status: updated.status,
          changes: [
            {
              fieldName: 'status',
              oldValue: oldStatus,
              newValue: updated.status,
              reason: patch.decisionNote,
            },
          ],
          ipAddress: req.ip,
        },
      );

      res.json({ ok: true, status: updated.status, application: toPublicApplication(updated) });
    } catch (error: unknown) {
      const safe = toSafeErrorResponse(error);
      res.status(safe.statusCode === 500 ? 400 : (safe.statusCode ?? 400)).json(safe);
    }
  },
);

router.get('/api/sewage/applications/:id/status-history', requireAuth, async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const id = String(req.params.id ?? '');
    const record = await loadRecordOr404(id, res);
    if (!record) return;
    if (!requireApplicationAccess(record, req.authUser)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    const result = await getApplicationStatusHistory(id);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }

    res.json({ ok: true, referenceNumber: result.referenceNumber, history: result.history });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/sewage/applications/:id/audit-trail', requireAuth, async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const id = String(req.params.id ?? '');
    const record = await loadRecordOr404(id, res);
    if (!record) return;
    if (!requireApplicationAccess(record, req.authUser)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    const result = await getApplicationAuditTrail(id);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }

    res.json({ ok: true, referenceNumber: result.referenceNumber, entries: result.entries });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get(
  '/api/sewage/applications/:id/export',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id ?? '');
      const record = await loadRecordOr404(id, res);
      if (!record) return;
      if (!requireApplicationAccess(record, req.authUser)) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      await auditTrail.logAction(
        record.referenceNumber,
        'DATA_EXPORTED',
        'SewageApplication',
        record.id,
        req.authUser.id,
        'Export av ansökningsunderlag',
        { userRole: req.authUser.role, ipAddress: req.ip },
      );

      const exportPayload = {
        referenceNumber: record.referenceNumber,
        propertyDesignation: record.propertyDesignation,
        coordinates: { latitude: record.latitude, longitude: record.longitude },
        applicant: { name: record.applicantName, email: record.applicantEmail },
        systemType: record.systemType,
        status: record.status,
        domainSnapshot: record.domainSnapshot,
        humanInTheLoop:
          'Underlaget är AI-assisterat. Handläggare ska verifiera alla uppgifter innan myndighetsinlämning.',
        exportedAt: new Date().toISOString(),
        exportedBy: req.authUser.id,
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).json({ ok: true, applicationId: record.id, export: exportPayload });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);
export default router;
