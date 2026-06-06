import { Router } from 'express';
import { requireAuth } from '../../../security/auth';
import { rateLimitByUser } from '../../../security/rateLimit';
import { assertProjectAccess } from '../../../security/projectAccess';
import { generateWithInteractions } from './interactionsService';
import { interactionsSessionRepository } from './interactionsSessionRepository';
import { PrototypeSessionResponse } from './types';

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

      // 1. Authorization check if projectId is provided
      if (projectId) {
        await assertProjectAccess(authUser, projectId, authUser.organisationId);
      }

      // 2. Session lookup/creation
      let session;
      if (sessionId) {
        session = await interactionsSessionRepository.findById(sessionId);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }
        // Verify ownership
        if (session.userId !== authUser.id || session.organisationId !== authUser.organisationId) {
          return res.status(403).json({ error: 'Unauthorized session access.' });
        }
      } else {
        session = await interactionsSessionRepository.create({
          userId: authUser.id,
          organisationId: authUser.organisationId,
          projectId,
          model: process.env.INTERACTIONS_MODEL || 'gemini-3.5-flash',
        });
      }

      // 3. Call Interactions API
      const result = await generateWithInteractions({
        prompt,
        previousInteractionId: session.lastInteractionId || undefined,
        store: true, // Prototype is stateful by default
      });

      // 4. Update session
      await interactionsSessionRepository.updateLastInteraction(session.id, result.interactionId);

      // 5. Response
      const response: PrototypeSessionResponse = {
        ok: true,
        sessionId: session.id,
        interactionId: result.interactionId,
        outputText: result.outputText,
        status: result.status,
        meta: {
          model: session.model,
          stepCount: result.stepCount,
        },
      };

      res.json(response);
    } catch (error: any) {
      console.error('[Interactions Prototype] Route error:', error);
      res.status(500).json({ 
        error: 'Interactions API request failed.', 
        details: error.message 
      });
    }
});

export default router;
