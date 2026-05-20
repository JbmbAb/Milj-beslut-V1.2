import express from 'express';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  createInvitation,
  listInvitations,
  acceptInvitation,
  revokeInvitation,
} from '../modules/organisation/public';
import { routeParam } from '../utils/routeUtils';

const router = express.Router();

router.post('/api/orgs/:orgId/invitations', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const orgId = routeParam(req.params.orgId);
    if (orgId !== req.authUser.organisationId) {
      res.status(403).json({ ok: false, error: 'Du har inte tillgång till denna organisation' });
      return;
    }

    const { email, role } = req.body as { email?: string; role?: string };
    if (!email || !role) {
      res.status(400).json({ ok: false, error: 'email och role krävs' });
      return;
    }

    const invitation = await createInvitation({
      orgId: routeParam(req.params.orgId),
      email,
      role,
      actingUserId: req.authUser.id,
    });
    res.json({ ok: true, invitation });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/orgs/:orgId/invitations', requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const orgId = routeParam(req.params.orgId);
    if (orgId !== req.authUser.organisationId) {
      res.status(403).json({ ok: false, error: 'Du har inte tillgång till denna organisation' });
      return;
    }

    const invitations = listInvitations(orgId);
    res.json({ ok: true, invitations });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/orgs/:orgId/invitations/accept', rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    const { token, bankidId } = req.body as { token?: string; bankidId?: string };
    if (!token || !bankidId) {
      res.status(400).json({ ok: false, error: 'token och bankidId krävs' });
      return;
    }

    const result = await acceptInvitation({ orgId: routeParam(req.params.orgId), token, bankidId });
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.delete(
  '/api/orgs/:orgId/invitations/:inviteId',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      const orgId = routeParam(req.params.orgId);
      if (orgId !== req.authUser.organisationId) {
        res.status(403).json({ ok: false, error: 'Du har inte tillgång till denna organisation' });
        return;
      }

      await revokeInvitation({
        orgId,
        inviteId: routeParam(req.params.inviteId),
        actingUserId: req.authUser.id,
      });
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

export default router;
