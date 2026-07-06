/**
 * Sewage Portal API Routes
 * Handles sewage application lifecycle: Draft -> Validation -> Submission -> Status
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../security/auth';
import { assertProjectAccess } from '../security/projectAccess';
import {
  handleMunicipalityWebhook,
  getStatusHistory,
  appealDecision,
  type MunicipalityStatusUpdate,
  generateComplianceReport,
  getAuditTrail,
  initiateBankIDSignature,
  completeBankIDSignature,
  checkSignatureStatus,
  verifyAllSignaturesForApplication,
  getSubmissionOrgAndProjectByKey,
  createSewageApplication,
  validateApplicationForSubmission,
  submitApplicationToMunicipality,
  generateSewageDossierPdf,
  getSewageApplicationById,
  updateSewageApplicationRecord,
  listSewageApplicationsByOrg,
} from '../modules/sewage/public';
import { logger } from '../logger';
import { getEnv } from '../security/env';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const router = Router();

function getRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

// ============================================================================
// LIFECYCLE: CREATE & READ
// ============================================================================

/**
 * GET /api/sewage/application/:id/pdf
 * Generate and download the dossier PDF
 */
router.get('/sewage/application/:id/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const application = await getSewageApplicationById(getRouteParam(req.params.id));
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (req.authUser?.role !== 'ADMIN' && application.organisationId !== req.authUser?.organisationId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tempDir = path.join(process.cwd(), 'storage', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const fileName = `Dossier_${application.referenceNumber}.pdf`;
    const outputPath = path.join(tempDir, fileName);

    await generateSewageDossierPdf(application, outputPath);

    res.download(outputPath, fileName, (err) => {
      if (err) logger.error('Error sending PDF file', { err });
      // Cleanup temp file after send
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    });
  } catch (error) {
    logger.error('Error generating PDF dossier', { error });
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

/**
 * POST /api/sewage/application
 * Create a new sewage application draft
 */
router.post('/sewage/application', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Unauthorized' });

    const application = await createSewageApplication({
      ...req.body,
      organisationId: req.authUser.organisationId,
      createdByUserId: req.authUser.id,
    });

    res.status(201).json(application);
  } catch (error) {
    logger.error('Error creating sewage application', { error });
    res.status(500).json({ error: 'Failed to create application' });
  }
});

/**
 * GET /api/sewage/applications
 * List all applications for the organization
 */
router.get('/sewage/applications', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Unauthorized' });

    const applications = await listSewageApplicationsByOrg(req.authUser.organisationId);
    res.json(applications);
  } catch (error) {
    logger.error('Error listing sewage applications', { error });
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

/**
 * GET /api/sewage/application/:id
 * Get a specific application by ID
 */
router.get('/sewage/application/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = getRouteParam(req.params.id);
    const application = await getSewageApplicationById(id);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (req.authUser?.role !== 'ADMIN' && application.organisationId !== req.authUser?.organisationId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(application);
  } catch (error) {
    logger.error('Error fetching sewage application', { error });
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

/**
 * PATCH /api/sewage/application/:id
 * Update an application draft
 */
router.patch('/sewage/application/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = getRouteParam(req.params.id);
    const application = await getSewageApplicationById(id);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (req.authUser?.role !== 'ADMIN' && application.organisationId !== req.authUser?.organisationId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await updateSewageApplicationRecord(id, req.body);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating sewage application', { error });
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// ============================================================================
// VALIDATION & SUBMISSION
// ============================================================================

/**
 * GET /api/sewage/application/:id/validate
 * Validate if the application is ready for submission
 */
router.get('/sewage/application/:id/validate', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await validateApplicationForSubmission(getRouteParam(req.params.id));
    res.json(result);
  } catch (error) {
    logger.error('Error validating sewage application', { error });
    res.status(500).json({ error: 'Validation failed' });
  }
});

/**
 * POST /api/sewage/application/:id/submit
 * Submit the application to the municipality
 */
router.post('/sewage/application/:id/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = getRouteParam(req.params.id);
    const application = await getSewageApplicationById(id);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (!application.municipalityCode) {
      return res.status(400).json({ error: 'Municipality code is required for submission' });
    }

    const validation = await validateApplicationForSubmission(id);
    if (!validation.canSubmit) {
      return res
        .status(400)
        .json({ error: 'Application is not valid for submission', details: validation.blockers });
    }

    const result = await submitApplicationToMunicipality(id, application.municipalityCode);
    res.json(result);
  } catch (error) {
    logger.error('Error submitting sewage application', { error });
    res.status(500).json({ error: 'Submission failed' });
  }
});

// ============================================================================
// HELPERS & WEBHOOKS
// ============================================================================

async function validateProjectAccessForReference(req: Request, referenceNumber: string) {
  if (!req.authUser) throw new Error('Unauthorized');

  const submission = await getSubmissionOrgAndProjectByKey(referenceNumber);
  if (!submission) throw new Error('Submission not found');

  await assertProjectAccess(req.authUser, submission.projectId, req.authUser.organisationId);
  return submission;
}

function verifyMunicipalitySignature(payload: any, signature: string | string[] | undefined): boolean {
  if (!signature || Array.isArray(signature)) return false;
  try {
    const secret = getEnv('MUNICIPALITY_WEBHOOK_SECRET');
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (error) {
    logger.error('Error verifying municipality signature', { error });
    return false;
  }
}

/**
 * GET /api/sewage/application/:referenceNumber/status
 */
router.get(
  '/sewage/application/:referenceNumber/status',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = getRouteParam(req.params.referenceNumber);
      await validateProjectAccessForReference(req, referenceNumber);

      res.json({
        ok: true,
        referenceNumber,
        status: 'SUBMITTED',
        source: 'local',
        note: process.env.SEWAGE_STATUS_ENDPOINT?.trim()
          ? 'Live statuskälla konfigurerad men ej implementerad i denna route.'
          : 'Statuskälla ej konfigurerad — returnerar senast kända lokala status.',
      });
    } catch (error) {
      logger.error('Error checking application status', { error });
      res.status(500).json({ error: 'Failed to check status' });
    }
  },
);

/**
 * POST /api/sewage/webhooks/municipality-status
 */
router.post('/sewage/webhooks/municipality-status', async (req: Request, res: Response) => {
  try {
    const payload = req.body as MunicipalityStatusUpdate;
    const signature = req.headers['x-municipality-signature'];

    if (process.env.NODE_ENV === 'production' || process.env.MUNICIPALITY_WEBHOOK_SECRET) {
      if (!verifyMunicipalitySignature(payload, signature)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const result = await handleMunicipalityWebhook(payload);
    res.json(result);
  } catch (error) {
    logger.error('Error processing municipality webhook', { error });
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// ============================================================================
// HISTORY, AUDIT & SIGNATURES
// ============================================================================

router.get(
  '/sewage/application/:referenceNumber/history',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = getRouteParam(req.params.referenceNumber);
      await validateProjectAccessForReference(req, referenceNumber);
      const history = await getStatusHistory(referenceNumber);
      res.json({ referenceNumber, history });
    } catch (error) {
      logger.error('Error fetching status history', { error });
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  },
);

router.post(
  '/sewage/application/:referenceNumber/appeal',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = getRouteParam(req.params.referenceNumber);
      await validateProjectAccessForReference(req, referenceNumber);
      const { appealReason, attachments } = req.body;
      if (!appealReason) return res.status(400).json({ error: 'Appeal reason is required' });
      const result = await appealDecision(referenceNumber, appealReason, attachments);
      res.json(result);
    } catch (error) {
      logger.error('Error submitting appeal', { error });
      res.status(500).json({ error: 'Failed to submit appeal' });
    }
  },
);

router.get(
  '/sewage/application/:referenceNumber/audit-trail',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = getRouteParam(req.params.referenceNumber);
      await validateProjectAccessForReference(req, referenceNumber);
      const auditTrailEntries = await getAuditTrail(referenceNumber);
      res.json({ referenceNumber, auditTrail: auditTrailEntries, entriesCount: auditTrailEntries.length });
    } catch (error) {
      logger.error('Error fetching audit trail', { error });
      res.status(500).json({ error: 'Failed to fetch audit trail' });
    }
  },
);

router.get(
  '/sewage/application/:referenceNumber/compliance-report',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = getRouteParam(req.params.referenceNumber);
      await validateProjectAccessForReference(req, referenceNumber);
      const report = await generateComplianceReport(referenceNumber);
      res.json(report);
    } catch (error) {
      logger.error('Error generating compliance report', { error });
      res.status(500).json({ error: 'Failed to generate report' });
    }
  },
);

router.post('/sewage/signatures/initiate-bankid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { referenceNumber, documentId, documentContent, personalNumber } = req.body;
    if (!referenceNumber || !documentId || !documentContent)
      return res.status(400).json({ error: 'Missing required fields' });
    await validateProjectAccessForReference(req, referenceNumber);
    const result = await initiateBankIDSignature(
      referenceNumber,
      documentId,
      documentContent,
      req.ip || '127.0.0.1',
      personalNumber,
    );
    res.json(result);
  } catch (error) {
    logger.error('Error initiating BankID signature', { error });
    res.status(500).json({ error: 'Failed to initiate signature' });
  }
});

router.post('/sewage/signatures/complete-bankid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orderRef, documentHash, referenceNumber } = req.body;
    if (!orderRef || !documentHash || !referenceNumber)
      return res.status(400).json({ error: 'Missing required fields' });
    await validateProjectAccessForReference(req, referenceNumber);
    const signature = await completeBankIDSignature(
      orderRef,
      documentHash,
      referenceNumber,
      req.ip || '127.0.0.1',
    );
    res.json({ ok: true, signature });
  } catch (error) {
    logger.error('Error completing BankID signature', { error });
    res.status(500).json({ error: 'Failed to complete signature' });
  }
});

router.get('/sewage/signatures/:orderRef/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = await checkSignatureStatus(getRouteParam(req.params.orderRef), req.ip || '127.0.0.1');
    res.json(status);
  } catch (error) {
    logger.error('Error checking signature status', { error });
    res.status(500).json({ error: 'Failed to check status' });
  }
});

router.get(
  '/sewage/application/:referenceNumber/signature-verification',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = getRouteParam(req.params.referenceNumber);
      await validateProjectAccessForReference(req, referenceNumber);
      const verification = await verifyAllSignaturesForApplication(referenceNumber);
      res.json(verification);
    } catch (error) {
      logger.error('Error verifying signatures', { error });
      res.status(500).json({ error: 'Failed to verify signatures' });
    }
  },
);

export default router;
