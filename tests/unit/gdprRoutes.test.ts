import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => ({
  getUserDataExport: vi.fn(),
  permanentlyDeleteUserData: vi.fn(),
  getUserOrganisationId: vi.fn(),
  appendDomainAudit: vi.fn(),
}));

vi.mock('../../server/modules/platform/public', () => ({
  getUserDataExport: mocks.getUserDataExport,
  permanentlyDeleteUserData: mocks.permanentlyDeleteUserData,
  getUserOrganisationId: mocks.getUserOrganisationId,
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

import gdprRoutes from '../../server/routes/gdpr.routes';

const app = express();
app.use(express.json());
app.use(gdprRoutes);

function authHeader(overrides: Partial<{ id: string; organisationId: string; role: 'ADMIN' | 'CONSULTANT' }> = {}) {
  return `Bearer ${
    createTokenPair({
      id: overrides.id ?? 'user-1',
      organisationId: overrides.organisationId ?? 'org-1',
      bankidId: 'bankid:user-1',
      role: overrides.role ?? 'CONSULTANT',
    } as any).accessToken
  }`;
}

describe('gdpr.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendDomainAudit.mockResolvedValue(undefined);
  });

  describe('DELETE /api/gdpr/me', () => {
    it('reports full success when nothing failed to delete', async () => {
      mocks.permanentlyDeleteUserData.mockResolvedValue({
        projectsDeleted: 1,
        auditLogsAnonymized: 0,
        tokensRevoked: 0,
        storageDeletionFailures: [],
      });

      const res = await request(app).delete('/api/gdpr/me').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.partial).toBe(false);
    });

    // HD-08 (F13): a storage-deletion failure must never be reported as unqualified success.
    it('reports partial success and does not claim ok:true when a stored file could not be removed', async () => {
      mocks.permanentlyDeleteUserData.mockResolvedValue({
        projectsDeleted: 1,
        auditLogsAnonymized: 0,
        tokensRevoked: 0,
        storageDeletionFailures: ['/tmp/unreachable.pdf'],
      });

      const res = await request(app).delete('/api/gdpr/me').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.partial).toBe(true);
      expect(res.body.storageDeletionFailures).toEqual(['/tmp/unreachable.pdf']);
    });
  });

  describe('DELETE /api/admin/gdpr/users/:userId', () => {
    it('returns 403 for a non-admin', async () => {
      const res = await request(app)
        .delete('/api/admin/gdpr/users/target-1')
        .set('Authorization', authHeader({ role: 'CONSULTANT' }));

      expect(res.status).toBe(403);
      expect(mocks.permanentlyDeleteUserData).not.toHaveBeenCalled();
    });

    // HD-07 (F12): an admin from one organisation must not be able to permanently delete a user
    // in a different organisation.
    it('returns 403 and does not delete when the target user belongs to a different organisation', async () => {
      mocks.getUserOrganisationId.mockResolvedValue('org-other');

      const res = await request(app)
        .delete('/api/admin/gdpr/users/target-1')
        .set('Authorization', authHeader({ organisationId: 'org-1', role: 'ADMIN' }));

      expect(res.status).toBe(403);
      expect(mocks.permanentlyDeleteUserData).not.toHaveBeenCalled();
      expect(mocks.appendDomainAudit).not.toHaveBeenCalled();
    });

    it('returns 403 when the target user does not exist', async () => {
      mocks.getUserOrganisationId.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/admin/gdpr/users/missing')
        .set('Authorization', authHeader({ role: 'ADMIN' }));

      expect(res.status).toBe(403);
      expect(mocks.permanentlyDeleteUserData).not.toHaveBeenCalled();
    });

    it('deletes and records an audit row when the target user is in the same organisation', async () => {
      mocks.getUserOrganisationId.mockResolvedValue('org-1');
      mocks.permanentlyDeleteUserData.mockResolvedValue({
        projectsDeleted: 2,
        auditLogsAnonymized: 3,
        tokensRevoked: 1,
        storageDeletionFailures: [],
      });

      const res = await request(app)
        .delete('/api/admin/gdpr/users/target-1')
        .set('Authorization', authHeader({ id: 'admin-1', organisationId: 'org-1', role: 'ADMIN' }));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.permanentlyDeleteUserData).toHaveBeenCalledWith('target-1');
      // HD-07: the deletion itself must be recorded, naming who performed it.
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'USER',
          entityId: 'target-1',
          action: 'GDPR_ADMIN_PERMANENT_DELETE',
          userId: 'admin-1',
        }),
      );
    });

    // HD-08: the admin-triggered deletion must also report partial success honestly.
    it('reports partial success when a stored file could not be removed', async () => {
      mocks.getUserOrganisationId.mockResolvedValue('org-1');
      mocks.permanentlyDeleteUserData.mockResolvedValue({
        projectsDeleted: 1,
        auditLogsAnonymized: 0,
        tokensRevoked: 0,
        storageDeletionFailures: ['/tmp/unreachable.pdf'],
      });

      const res = await request(app)
        .delete('/api/admin/gdpr/users/target-1')
        .set('Authorization', authHeader({ organisationId: 'org-1', role: 'ADMIN' }));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.partial).toBe(true);
    });
  });
});
