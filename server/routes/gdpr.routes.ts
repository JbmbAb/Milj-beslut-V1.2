import express from 'express';
import { requireAuth } from '../security/auth';
import { toSafeErrorResponse } from '../security/secureErrors';
import { getUserDataExport, permanentlyDeleteUserData, getUserOrganisationId } from '../modules/platform/public';
import { appendDomainAudit } from '../security/auditTrail';

const router = express.Router();

/**
 * GET /api/gdpr/me/export
 * Exports all data associated with the authenticated user.
 */
router.get('/api/gdpr/me/export', requireAuth, async (req: any, res) => {
  try {
    const userData = await getUserDataExport(req.authUser.id);
    res.json({ ok: true, data: userData });
  } catch (error) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

/**
 * DELETE /api/gdpr/me
 * Permanently deletes all data associated with the authenticated user.
 */
router.delete('/api/gdpr/me', requireAuth, async (req: any, res) => {
  try {
    const result = await permanentlyDeleteUserData(req.authUser.id);
    const partial = result.storageDeletionFailures.length > 0;
    // HD-08 (F13): never claim full success when a stored file could not be removed.
    res.json({
      ok: !partial,
      partial,
      message: partial
        ? 'User database records permanently deleted; some stored files could not be removed and require manual follow-up'
        : 'User data permanently deleted',
      ...result,
    });
  } catch (error) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

/**
 * DELETE /api/admin/gdpr/users/:userId
 * Permanently deletes a user and their associated data. Requires ADMIN role.
 */
router.delete('/api/admin/gdpr/users/:userId', requireAuth, async (req: any, res) => {
  if (req.authUser.role !== 'ADMIN') {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  try {
    const { userId } = req.params;

    // HD-07 (F12): an admin may only permanently delete users within their own organisation.
    const targetOrganisationId = await getUserOrganisationId(userId);
    if (targetOrganisationId === null || targetOrganisationId !== req.authUser.organisationId) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const result = await permanentlyDeleteUserData(userId);

    // HD-07: the deletion transaction anonymises the deleted user's OWN prior audit rows; it
    // never records that this admin performed the deletion. Write that record explicitly.
    await appendDomainAudit({
      entityType: 'USER',
      entityId: userId,
      action: 'GDPR_ADMIN_PERMANENT_DELETE',
      userId: req.authUser.id,
      payload: {
        targetOrganisationId,
        storageDeletionFailureCount: result.storageDeletionFailures.length,
      },
    });

    const partial = result.storageDeletionFailures.length > 0;
    // HD-08 (F13): never claim full success when a stored file could not be removed.
    res.json({ ok: !partial, partial, result });
  } catch (error) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
