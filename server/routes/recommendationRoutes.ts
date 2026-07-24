import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import {
  createAIRecommendation,
  getPendingRecommendationsForReview,
  submitApprovalReview,
  type AIClassificationSuggestion,
  type ApprovalReview,
} from '../modules/classification/public';
import { logger } from '../logger';

const router = Router();

/**
 * POST /api/recommendations/recommend
 * Create a new AI recommendation recommendation (does NOT apply it immediately)
 */
router.post(
  '/api/recommendations/recommend',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const suggestion: AIClassificationSuggestion = req.body;

      if (!suggestion.caseId || !suggestion.documentId || !suggestion.aiClassification) {
        return res.status(400).json({
          ok: false,
          error: 'Missing required fields: caseId, documentId, aiClassification',
        });
      }

      logger.info('Creating AI recommendation via recommendationRoutes', {
        caseId: suggestion.caseId,
        documentId: suggestion.documentId,
      });

      const recommendation = await createAIRecommendation(suggestion);

      res.status(201).json({
        ok: true,
        recommendation,
        status: 'SUGGESTED',
        message: 'AI recommendation created. Awaiting human review.',
      });
    } catch (error) {
      logger.error('Error creating AI recommendation', { error });
      next(error);
    }
  }
);

/**
 * GET /api/cases/:caseId/pending-reviews
 * Retrieve all pending recommendations for a specific case for human review
 */
router.get(
  '/api/cases/:caseId/pending-reviews',
  requireAuth,
  rateLimitByUser(60, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.caseId;
      if (!caseId) {
        return res.status(400).json({ ok: false, error: 'caseId parameter is required' });
      }

      logger.info('Fetching pending reviews via recommendationRoutes', { caseId });

      const pending = await getPendingRecommendationsForReview(caseId);

      res.json({
        ok: true,
        caseId,
        pendingCount: pending.length,
        recommendations: pending,
      });
    } catch (error) {
      logger.error('Error fetching pending reviews', { error });
      next(error);
    }
  }
);

/**
 * POST /api/recommendations/:recommendationId/submit-review
 * Submit human approval decision (APPROVED, REJECTED, etc.)
 */
router.post(
  '/api/recommendations/:recommendationId/submit-review',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const recommendationId = req.params.recommendationId;
      if (!recommendationId) {
        return res.status(400).json({ ok: false, error: 'recommendationId parameter is required' });
      }

      const { decision, reviewedBy, reviewNotes, appliedWithChanges, changesNotes } = req.body ?? {};

      if (!decision || !['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION'].includes(decision)) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid decision. Must be one of: APPROVED, REJECTED, NEEDS_CLARIFICATION',
        });
      }

      if (!reviewedBy) {
        return res.status(400).json({ ok: false, error: 'reviewedBy is required' });
      }

      const review: ApprovalReview = {
        recommendationId,
        decision,
        reviewedBy,
        reviewNotes,
        appliedWithChanges,
        changesNotes,
      };

      logger.info('Submitting approval review via recommendationRoutes', { recommendationId, decision });

      const recommendation = await submitApprovalReview(review);

      res.json({
        ok: true,
        recommendation,
        decision,
        message: `Human review decision recorded: ${decision}`,
      });
    } catch (error) {
      logger.error('Error submitting approval review', { error });
      next(error);
    }
  }
);

export default router;
