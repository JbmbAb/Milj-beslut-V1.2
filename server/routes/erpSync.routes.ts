import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { syncMilestoneToErp } from '../services/erpSyncService';
import { routeParam } from '../utils/routeUtils';

const router = express.Router();

router.post(
  '/api/projects/:projectId/milestones/:milestoneId/sync-erp',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      
      const projectId = routeParam(req.params.projectId);
      const milestoneId = routeParam(req.params.milestoneId);
      const { description, amount } = req.body as { description?: string, amount?: number };

      if (!description || typeof amount !== 'number') {
        res.status(400).json({ ok: false, error: 'description och amount krävs' });
        return;
      }

      const transaction = await syncMilestoneToErp(projectId, milestoneId, description, amount);

      res.json({ ok: true, transaction });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
