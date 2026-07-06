import express from 'express';
import { requireAuth } from '../security/auth';
import { toSafeErrorResponse } from '../security/secureErrors';
import { getUserDataExport, permanentlyDeleteUserData } from '../modules/platform/public';

const router = express.Router();

/**
 * GET /api/gdpr/me/export
 * Exports all data associated with the authenticated user.
 */
router.get('/me/export', requireAuth, async (req: any, res) => {
  try {
    const userData = await getUserDataExport(req.authUser.id);
    res.json({ ok: true, export: userData });
  } catch (error) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

/**
 * DELETE /api/admin/gdpr/users/:userId
 * Permanently deletes a user and their associated data. Requires ADMIN role.
 */
router.delete('/admin/users/:userId', requireAuth, async (req: any, res) => {
  if (req.authUser.role !== 'ADMIN') {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  try {
    const { userId } = req.params;
    const result = await permanentlyDeleteUserData(userId);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export { router as gdprRouter };
