import express from 'express';
import { requireAuth } from '../../../security/auth';
import { rateLimitByUser } from '../../../security/rateLimit';
import { SecureError, toSafeErrorResponse } from '../../../security/secureErrors';
import { isInteractionsPrototypeEnabled } from './interactionsConfig';
import { runInteractionPrototypeTurn } from './interactionsOrchestrator';

const router = express.Router();

router.post(
  '/api/prototype/interactions',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res, next) => {
    if (!isInteractionsPrototypeEnabled()) {
      res.status(404).json({ ok: false, error: 'Not found' });
      return;
    }

    try {
      const result = await runInteractionPrototypeTurn({
        authUser: req.authUser!,
        prompt: String(req.body?.prompt || ''),
        sessionId: req.body?.sessionId != null ? String(req.body.sessionId) : undefined,
        projectId: req.body?.projectId != null ? String(req.body.projectId) : undefined,
      });

      if (result.ok === false) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }

      res.status(200).json({
        ok: true,
        sessionId: result.sessionId,
        interactionId: result.interactionId,
        outputText: result.outputText,
        status: result.status,
        meta: result.meta,
      });
    } catch (error) {
      if (error instanceof SecureError) {
        res.status(error.statusCode).json(toSafeErrorResponse(error));
        return;
      }
      next(error);
    }
  },
);

export default router;
