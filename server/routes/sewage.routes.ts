/**
 * Sewage Portal API Routes
 * Handles sewage application submission, document generation, and status tracking
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../security/auth';
import { assertProjectAccess } from '../security/projectAccess';
import {
  generateSewageApplicationDocuments,
  submitSewageApplicationToMunicipality,
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
} from '../modules/sewage/public';
import { logger } from '../logger';
import { getEnv } from '../security/env';
import crypto from 'node:crypto';
import type { SewageApplication, SewageProtectionProfile, SewageGISAnalysis } from '../../types';

const router = Router();

// ============================================================================
// SUBMIT APPLICATION
// ============================================================================

/**
 * POST /api/sewage/application/:id/submit
 * Submit a sewage application to the municipality
 * Bundles all documents and sends to municipality API
 * Returns: referenceNumber, municipalityEmail, estimatedProcessingTime
 */
router.post('/sewage/application/:id/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { application, protectionProfile, analysis, municipalityCode, situationPlanSVG, crossSectionSVG } =
      req.body as {
        application: SewageApplication;
        protectionProfile: SewageProtectionProfile;
        analysis: SewageGISAnalysis;
        municipalityCode: string;
        situationPlanSVG?: string;
        crossSectionSVG?: string;
      };

    if (!application || !protectionProfile || !municipalityCode) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate documents if not provided
    let situationPlan = situationPlanSVG;
    let crossSection = crossSectionSVG;

    if (!situationPlan || !crossSection) {
      const { situationPlanSVG: genPlan, crossSectionSVG: genSection } = generateSewageApplicationDocuments(
        application,
        protectionProfile,
        analysis,
      );
      situationPlan = genPlan;
      crossSection = genSection;
    }

    // Submit to municipality
    const submissionResult = await submitSewageApplicationToMunicipality(
      application,
      protectionProfile,
      municipalityCode,
      situationPlan,
      crossSection,
      req.authUser.bankidId || 'applicant@example.com',
      application.projectId,
      req.authUser.organisationId,
    );

    const estimatedProcessingWeeks = Math.ceil((submissionResult.estimatedProcessingDays || 30) / 7);

    res.json({
      ok: true,
      referenceNumber: submissionResult.referenceNumber,
      municipalityCode: submissionResult.municipalityCode,
      municipalityEmail: submissionResult.municipalityContactEmail,
      estimatedProcessingWeeks,
      submittedAt: submissionResult.submittedAt,
    });
  } catch (error) {
    logger.error('Error submitting application', { error });
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// ============================================================================
// HELPERS
// ============================================================================

async function validateProjectAccessForReference(req: Request, referenceNumber: string) {
  if (!req.authUser) throw new Error('Unauthorized');

  const submission = await getSubmissionOrgAndProjectByKey(referenceNumber);

  if (!submission) {
    throw new Error('Submission not found');
  }

  await assertProjectAccess(req.authUser, submission.projectId, req.authUser.organisationId);
  return submission;
}

/**
 * Verify HMAC signature from municipality
 */
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

// ============================================================================
// POLL APPLICATION STATUS
// ============================================================================

/**
 * GET /api/sewage/application/:referenceNumber/status
 * Get the current status of a submitted application
 * Returns: current status, any municipality notes, required actions, decision if applicable
 */
router.get(
  '/sewage/application/:referenceNumber/status',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = Array.isArray(req.params.referenceNumber)
        ? req.params.referenceNumber[0]
        : req.params.referenceNumber;

      await validateProjectAccessForReference(req, referenceNumber);

      res.status(501).json({
        ok: false,
        code: 'SEWAGE_STATUS_SOURCE_NOT_CONFIGURED',
        error:
          'Statuskälla för enskilt avlopp är inte konfigurerad. Ingen lokal ersättningsstatus returneras.',
        referenceNumber,
      });
    } catch (error) {
      logger.error('Error checking application status', { error });
      res.status(500).json({ error: 'Failed to check status' });
    }
  },
);

// ============================================================================
// MUNICIPALITY WEBHOOK (FOR PUSH UPDATES FROM MUNICIPALITY SYSTEMS)
// ============================================================================

/**
 * POST /api/sewage/webhooks/municipality-status
 * Municipality calls this endpoint when application status changes
 * Signature validation: X-Municipality-Signature for HMAC verification
 */
router.post('/sewage/webhooks/municipality-status', async (req: Request, res: Response) => {
  try {
    const payload = req.body as MunicipalityStatusUpdate;

    const signature = req.headers['x-municipality-signature'];

    // In production, always verify signature
    if (process.env.NODE_ENV === 'production' || process.env.MUNICIPALITY_WEBHOOK_SECRET) {
      if (!verifyMunicipalitySignature(payload, signature)) {
        logger.warn('Invalid municipality webhook signature', { signature });
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
// STATUS HISTORY & APPEAL
// ============================================================================

/**
 * GET /api/sewage/application/:referenceNumber/history
 * Get complete status history for an application
 */
router.get(
  '/sewage/application/:referenceNumber/history',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = Array.isArray(req.params.referenceNumber)
        ? req.params.referenceNumber[0]
        : req.params.referenceNumber;
      if (!referenceNumber) {
        return res.status(400).json({ error: 'referenceNumber is required' });
      }

      await validateProjectAccessForReference(req, referenceNumber);

      const history = await getStatusHistory(referenceNumber);

      res.json({
        referenceNumber,
        history,
      });
    } catch (error) {
      logger.error('Error fetching status history', { error });
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  },
);

/**
 * POST /api/sewage/application/:referenceNumber/appeal
 * Appeal a rejected decision to länstyrelsen (County Administrative Board)
 */
router.post(
  '/sewage/application/:referenceNumber/appeal',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = Array.isArray(req.params.referenceNumber)
        ? req.params.referenceNumber[0]
        : req.params.referenceNumber;
      if (!referenceNumber) {
        return res.status(400).json({ error: 'referenceNumber is required' });
      }

      await validateProjectAccessForReference(req, referenceNumber);

      const { appealReason, attachments } = req.body;

      if (!appealReason) {
        return res.status(400).json({ error: 'Appeal reason is required' });
      }

      const result = await appealDecision(referenceNumber, appealReason, attachments);

      res.json(result);
    } catch (error) {
      logger.error('Error submitting appeal', { error });
      res.status(500).json({ error: 'Failed to submit appeal' });
    }
  },
);

// ============================================================================
// AUDIT TRAIL & COMPLIANCE
// ============================================================================

/**
 * GET /api/sewage/application/:referenceNumber/audit-trail
 * Get complete audit trail for application (juridical traceability)
 */
router.get(
  '/api/sewage/application/:referenceNumber/audit-trail',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = Array.isArray(req.params.referenceNumber)
        ? req.params.referenceNumber[0]
        : req.params.referenceNumber;

      await validateProjectAccessForReference(req, referenceNumber);

      const auditTrailEntries = await getAuditTrail(referenceNumber);

      res.json({
        referenceNumber,
        auditTrail: auditTrailEntries,
        entriesCount: auditTrailEntries.length,
      });
    } catch (error) {
      logger.error('Error fetching audit trail', { error });
      res.status(500).json({ error: 'Failed to fetch audit trail' });
    }
  },
);

/**
 * GET /api/sewage/application/:referenceNumber/compliance-report
 * Generate compliance report with full juridical, environmental, and economic traceability
 */
router.get(
  '/api/sewage/application/:referenceNumber/compliance-report',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = Array.isArray(req.params.referenceNumber)
        ? req.params.referenceNumber[0]
        : req.params.referenceNumber;

      await validateProjectAccessForReference(req, referenceNumber);

      const report = await generateComplianceReport(referenceNumber);

      res.json(report);
    } catch (error) {
      logger.error('Error generating compliance report', { error });
      res.status(500).json({ error: 'Failed to generate report' });
    }
  },
);

// ============================================================================
// DIGITAL SIGNATURES (BANKID)
// ============================================================================

/**
 * POST /api/sewage/signatures/initiate-bankid
 * Initiate BankID signature for application submission
 */
router.post('/sewage/signatures/initiate-bankid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { referenceNumber, documentId, documentContent, personalNumber } = req.body;

    if (!referenceNumber || !documentId || !documentContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

/**
 * POST /api/sewage/signatures/complete-bankid
 * Complete BankID signature after user has signed
 */
router.post('/sewage/signatures/complete-bankid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orderRef, documentHash, referenceNumber } = req.body;

    if (!orderRef || !documentHash || !referenceNumber) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await validateProjectAccessForReference(req, referenceNumber);

    const signature = await completeBankIDSignature(
      orderRef,
      documentHash,
      referenceNumber,
      req.ip || '127.0.0.1',
    );

    res.json({
      ok: true,
      signature,
    });
  } catch (error) {
    logger.error('Error completing BankID signature', { error });
    res.status(500).json({ error: 'Failed to complete signature' });
  }
});

/**
 * GET /api/sewage/signatures/:orderRef/status
 * Check status of BankID signature order
 */
router.get('/api/sewage/signatures/:orderRef/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const orderRef = Array.isArray(req.params.orderRef) ? req.params.orderRef[0] : req.params.orderRef;

    const status = await checkSignatureStatus(orderRef, req.ip || '127.0.0.1');

    res.json(status);
  } catch (error) {
    logger.error('Error checking signature status', { error });
    res.status(500).json({ error: 'Failed to check status' });
  }
});

/**
 * GET /api/sewage/application/:referenceNumber/signature-verification
 * Verify all signatures for an application
 */
router.get(
  '/api/sewage/application/:referenceNumber/signature-verification',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const referenceNumber = Array.isArray(req.params.referenceNumber)
        ? req.params.referenceNumber[0]
        : req.params.referenceNumber;

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
