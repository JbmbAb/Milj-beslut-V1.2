/**
 * Classification Review Routes
 * Human-in-the-loop endpoints for decision feedback and approval workflow
 *
 * Core principle: Recommendations flow through distinct states:
 *   SUGGESTED → REVIEWING → APPROVED/REJECTED → APPLIED
 */

import { Router, Request, Response } from 'express';
import {
  createAIRecommendation,
  getPendingRecommendationsForReview,
  markAsReviewing,
  submitApprovalReview,
  applyApprovedRecommendation,
  verifySourceIntegrity,
  getApprovalAuditTrail,
  openApprovalGate,
  lockApprovalGate,
  finalizeApprovalGate,
  getApprovalGateStatus,
  type AIClassificationSuggestion,
  type ApprovalReview,
} from '../modules/classification/public';
import { logger } from '../logger';

const router = Router();

// ============================================================================
// AI RECOMMENDATION CREATION
// ============================================================================

/**
 * POST /api/classifications/recommend
 * Create an AI recommendation (does NOT apply it)
 * Status: SUGGESTED (awaiting human review)
 */
router.post('/classifications/recommend', async (req: Request, res: Response) => {
  try {
    const suggestion: AIClassificationSuggestion = req.body;

    if (!suggestion.caseId || !suggestion.documentId || !suggestion.aiClassification) {
      return res.status(400).json({
        error: 'Missing required fields: caseId, documentId, aiClassification',
      });
    }

    const recommendation = await createAIRecommendation(suggestion);

    res.status(201).json({
      ok: true,
      recommendation,
      status: 'SUGGESTED',
      message: 'AI recommendation created. Awaiting human review.',
    });
  } catch (error) {
    logger.error('Error creating AI recommendation', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create recommendation',
    });
  }
});

// ============================================================================
// HUMAN REVIEW WORKFLOW
// ============================================================================

/**
 * GET /api/cases/:caseId/pending-reviews
 * Get all pending recommendations for human review
 */
router.get('/cases/:caseId/pending-reviews', async (req: Request, res: Response) => {
  try {
    const caseId = Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId;

    const pending = await getPendingRecommendationsForReview(caseId);

    res.json({
      caseId,
      pendingCount: pending.length,
      recommendations: pending,
    });
  } catch (error) {
    logger.error('Error fetching pending reviews', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch pending reviews',
    });
  }
});

/**
 * PATCH /api/classifications/:recommendationId/mark-reviewing
 * Mark a recommendation as REVIEWING (human has opened it)
 */
router.patch('/classifications/:recommendationId/mark-reviewing', async (req: Request, res: Response) => {
  try {
    const recommendationId = Array.isArray(req.params.recommendationId)
      ? req.params.recommendationId[0]
      : req.params.recommendationId;
    const { reviewedBy } = req.body;

    if (!reviewedBy) {
      return res.status(400).json({ error: 'reviewedBy is required' });
    }

    const recommendation = await markAsReviewing(recommendationId, reviewedBy);

    res.json({
      ok: true,
      recommendation,
      status: 'REVIEWING',
    });
  } catch (error) {
    logger.error('Error marking recommendation as reviewing', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update recommendation',
    });
  }
});

/**
 * POST /api/classifications/:recommendationId/submit-review
 * Submit human approval decision (APPROVED, REJECTED, or NEEDS_CLARIFICATION)
 * Does NOT apply the decision - only marks it as approved
 */
router.post('/classifications/:recommendationId/submit-review', async (req: Request, res: Response) => {
  try {
    const recommendationId = Array.isArray(req.params.recommendationId)
      ? req.params.recommendationId[0]
      : req.params.recommendationId;

    const review: ApprovalReview = {
      recommendationId,
      decision: req.body.decision,
      reviewedBy: req.body.reviewedBy,
      reviewNotes: req.body.reviewNotes,
      appliedWithChanges: req.body.appliedWithChanges,
      changesNotes: req.body.changesNotes,
    };

    if (!review.decision || !['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION'].includes(review.decision)) {
      return res.status(400).json({
        error: 'Invalid decision. Must be one of: APPROVED, REJECTED, NEEDS_CLARIFICATION',
      });
    }

    if (!review.reviewedBy) {
      return res.status(400).json({ error: 'reviewedBy is required' });
    }

    const recommendation = await submitApprovalReview(review);

    res.json({
      ok: true,
      recommendation,
      decision: review.decision,
      message: `Human review decision recorded: ${review.decision}`,
    });
  } catch (error) {
    logger.error('Error submitting approval review', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to submit review',
    });
  }
});

// ============================================================================
// APPLICATION STEP
// ============================================================================

/**
 * POST /api/classifications/:recommendationId/apply
 * Apply an APPROVED recommendation to the RequirementCase
 * CRITICAL: Only call for recommendations with status === 'APPROVED'
 */
router.post('/classifications/:recommendationId/apply', async (req: Request, res: Response) => {
  try {
    const recommendationId = Array.isArray(req.params.recommendationId)
      ? req.params.recommendationId[0]
      : req.params.recommendationId;
    const { appliedBy } = req.body;

    if (!appliedBy) {
      return res.status(400).json({ error: 'appliedBy is required' });
    }

    const result = await applyApprovedRecommendation(recommendationId, appliedBy);

    res.json({
      ok: result.success,
      result,
      message: 'Approved recommendation has been applied.',
    });
  } catch (error) {
    logger.error('Error applying recommendation', { error });
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to apply recommendation',
    });
  }
});

// ============================================================================
// VERIFICATION & AUDIT
// ============================================================================

/**
 * GET /api/classifications/:recommendationId/verify-integrity
 * Verify that the source document has not changed
 */
router.get('/classifications/:recommendationId/verify-integrity', async (req: Request, res: Response) => {
  try {
    const recommendationId = Array.isArray(req.params.recommendationId)
      ? req.params.recommendationId[0]
      : req.params.recommendationId;

    const verification = await verifySourceIntegrity(recommendationId);

    res.json({
      recommendationId,
      ...verification,
    });
  } catch (error) {
    logger.error('Error verifying source integrity', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to verify integrity',
    });
  }
});

/**
 * GET /api/classifications/:recommendationId/audit-trail
 * Get full approval audit trail
 */
router.get('/classifications/:recommendationId/audit-trail', async (req: Request, res: Response) => {
  try {
    const recommendationId = Array.isArray(req.params.recommendationId)
      ? req.params.recommendationId[0]
      : req.params.recommendationId;

    const auditTrail = await getApprovalAuditTrail(recommendationId);

    res.json({
      recommendationId,
      auditTrailCount: auditTrail.length,
      auditTrail,
    });
  } catch (error) {
    logger.error('Error fetching audit trail', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch audit trail',
    });
  }
});

// ============================================================================
// APPROVAL GATE MANAGEMENT
// ============================================================================

/**
 * POST /api/cases/:caseId/documents/:documentId/approval-gate/open
 * Open a HumanApprovalGate
 */
router.post(
  '/cases/:caseId/documents/:documentId/approval-gate/open',
  async (req: Request, res: Response) => {
    try {
      const caseId = Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId;
      const documentId = Array.isArray(req.params.documentId)
        ? req.params.documentId[0]
        : req.params.documentId;

      const gate = await openApprovalGate(caseId, documentId);

      res.json({
        ok: true,
        gate,
        message: 'Approval gate opened. Recommendations can now be reviewed.',
      });
    } catch (error) {
      logger.error('Error opening approval gate', { error });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to open gate',
      });
    }
  },
);

/**
 * PATCH /api/cases/:caseId/documents/:documentId/approval-gate/lock
 * Lock the gate for final review
 */
router.patch(
  '/cases/:caseId/documents/:documentId/approval-gate/lock',
  async (req: Request, res: Response) => {
    try {
      const caseId = Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId;
      const documentId = Array.isArray(req.params.documentId)
        ? req.params.documentId[0]
        : req.params.documentId;
      const { lockedBy } = req.body;

      if (!lockedBy) {
        return res.status(400).json({ error: 'lockedBy is required' });
      }

      const gate = await lockApprovalGate(caseId, documentId, lockedBy);

      res.json({
        ok: true,
        gate,
        message: 'Approval gate locked. No new recommendations can be added.',
      });
    } catch (error) {
      logger.error('Error locking approval gate', { error });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to lock gate',
      });
    }
  },
);

/**
 * PATCH /api/cases/:caseId/documents/:documentId/approval-gate/finalize
 * Finalize the gate
 */
router.patch(
  '/cases/:caseId/documents/:documentId/approval-gate/finalize',
  async (req: Request, res: Response) => {
    try {
      const caseId = Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId;
      const documentId = Array.isArray(req.params.documentId)
        ? req.params.documentId[0]
        : req.params.documentId;

      const gate = await finalizeApprovalGate(caseId, documentId);

      res.json({
        ok: true,
        gate,
        message: 'Approval gate finalized.',
      });
    } catch (error) {
      logger.error('Error finalizing approval gate', { error });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to finalize gate',
      });
    }
  },
);

/**
 * GET /api/cases/:caseId/documents/:documentId/approval-gate/status
 * Get gate status and recommendation counts
 */
router.get(
  '/cases/:caseId/documents/:documentId/approval-gate/status',
  async (req: Request, res: Response) => {
    try {
      const caseId = Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId;
      const documentId = Array.isArray(req.params.documentId)
        ? req.params.documentId[0]
        : req.params.documentId;

      const status = await getApprovalGateStatus(caseId, documentId);

      res.json({
        caseId,
        documentId,
        ...status,
      });
    } catch (error) {
      logger.error('Error getting approval gate status', { error });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get gate status',
      });
    }
  },
);

export default router;
