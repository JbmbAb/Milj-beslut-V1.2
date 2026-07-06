import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { generateBankComplianceIndex } from '../modules/compliance/public';
import { routeParam } from '../utils/routeUtils';

const router = express.Router();

router.get(
  '/api/projects/:projectId/bank-compliance-index',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      
      const projectId = routeParam(req.params.projectId);
      const report = await generateBankComplianceIndex(projectId);

      res.json({ ok: true, report });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
