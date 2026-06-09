import { Router } from 'express';
import { requireAuth } from '../../../security/auth';
import { rateLimitByUser } from '../../../security/rateLimit';
import { assertProjectAccess } from '../../../security/projectAccess';
import { runInteractionPrototypeTurn } from './interactionsOrchestrator';

const router = Router();

/**
 * POST /api/prototype/interactions
 * 
 * Body:
 * {
 *   "prompt": "string",
 *   "sessionId": "string (optional)",
 *   "projectId": "string (optional)"
 * }
 */
router.post('/api/prototype/interactions', 
  requireAuth, 
  rateLimitByUser(20, 60_000), 
  async (req, res) => {
    try {
      // Guard: Prototyp enabled + not production (double check, though router mount should handle it)
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Endpoint not available in production.' });
      }
      if (process.env.INTERACTIONS_PROTOTYPE_ENABLED !== 'true') {
        return res.status(403).json({ error: 'Interactions prototype is disabled.' });
      }

      const { prompt, sessionId, projectId } = req.body;
      const authUser = (req as any).user;

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required.' });
      }

      const result = await runInteractionPrototypeTurn({
        authUser,
        prompt,
        sessionId,
        projectId,
      });

      if (!result.ok || 'error' in result) {
        return res.status(Number(result.status) || 500).json({ error: (result as any).error });
      }

      res.json(result);
    } catch (error: any) {
      console.error('[Interactions Prototype] Route error:', error);
      res.status(500).json({ 
        error: 'Interactions API request failed.', 
        details: error.message 
      });
    }
});

export default router;
