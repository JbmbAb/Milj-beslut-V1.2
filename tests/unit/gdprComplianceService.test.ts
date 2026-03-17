import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Prisma mock ──────────────────────────────────────────────────────────────
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: {
      update: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 2 })),
    },
    projectMember: {
      findMany: vi.fn(async () => [{ projectId: 'proj-1' }, { projectId: 'proj-2' }]),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
    propertyAccessLog: {
      findMany: vi.fn(async () => [
        { id: 'log-1', propertyDesignation: 'ABC 1:1', purpose: 'planning', timestamp: new Date('2024-01-01'), responseClass: 'OK' },
      ]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    searchQueryLog: {
      findMany: vi.fn(async () => [
        { id: 'sq-1', query: 'test', resultCount: 3, createdAt: new Date('2024-01-02') },
      ]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    auditTrail: {
      updateMany: vi.fn(async () => ({ count: 5 })),
    },
    tokenRevocation: {
      deleteMany: vi.fn(async () => ({ count: 3 })),
      findMany: vi.fn(async () => []),
    },
    user: {
      findUnique: vi.fn(async () => ({
        id: 'user-1',
        bankidId: 'bid-1',
        organisationId: 'org-1',
        role: 'USER',
        createdAt: new Date('2023-06-01'),
      })),
      delete: vi.fn(async () => undefined),
    },
  },
}));

// ── tokenRepository mock ─────────────────────────────────────────────────────
vi.mock('../../server/repositories/tokenRepository', () => ({
  cleanupExpiredTokenRevocations: vi.fn(async () => 4),
}));

import { prisma } from '../../server/db/prisma';
import {
  setProjectRetentionPolicy,
  archiveExpiredProjects,
  permanentlyDeleteUserData,
  exportUserPersonalData,
  runGdprMaintenanceJob,
} from '../../server/services/gdprComplianceService';

describe('gdprComplianceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── setProjectRetentionPolicy ──────────────────────────────────────────────
  describe('setProjectRetentionPolicy', () => {
    it('calls prisma.project.update with a future retentionUntil date', async () => {
      const before = Date.now();
      await setProjectRetentionPolicy('proj-1', 30);
      const after = Date.now();

      const updateMock = vi.mocked(prisma.project.update);
      expect(updateMock).toHaveBeenCalledOnce();

      const call = updateMock.mock.calls[0][0] as { where: { id: string }; data: { retentionUntil: Date } };
      expect(call.where.id).toBe('proj-1');
      const retentionUntil = call.data.retentionUntil.getTime();
      // Should be ~30 days in the future
      expect(retentionUntil).toBeGreaterThan(before + 29 * 24 * 3600 * 1000);
      expect(retentionUntil).toBeLessThan(after + 31 * 24 * 3600 * 1000);
    });
  });

  // ── archiveExpiredProjects ─────────────────────────────────────────────────
  describe('archiveExpiredProjects', () => {
    it('returns the count of archived projects', async () => {
      const count = await archiveExpiredProjects();
      expect(count).toBe(2);
      expect(prisma.project.updateMany).toHaveBeenCalledOnce();
    });
  });

  // ── permanentlyDeleteUserData ──────────────────────────────────────────────
  describe('permanentlyDeleteUserData', () => {
    it('deletes PII and anonymizes audit logs, then removes user', async () => {
      const result = await permanentlyDeleteUserData('user-1');

      expect(result.projectsDeleted).toBe(2);       // 2 memberships found
      expect(result.auditLogsAnonymized).toBe(5);   // mocked updateMany count
      expect(result.tokensRevoked).toBe(3);         // mocked deleteMany count

      // Membership PII must be deleted
      expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      // Access logs (PII) must be deleted
      expect(prisma.propertyAccessLog.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      // Search query logs (PII) must be deleted
      expect(prisma.searchQueryLog.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      // Audit trail must be ANONYMIZED, not deleted
      expect(prisma.auditTrail.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { userId: null },
      });
      // User account must be removed last
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });

  // ── exportUserPersonalData ─────────────────────────────────────────────────
  describe('exportUserPersonalData', () => {
    it('returns structured export containing user, projects, logs and queries', async () => {
      const data = await exportUserPersonalData('user-1');

      expect(data.user).toBeDefined();
      expect(data.user.id).toBe('user-1');
      expect(Array.isArray(data.projects)).toBe(true);
      expect(data.projects.length).toBe(2);
      expect(Array.isArray(data.accessLogs)).toBe(true);
      expect(data.accessLogs.length).toBe(1);
      expect(Array.isArray(data.searchQueries)).toBe(true);
      expect(data.searchQueries.length).toBe(1);
    });

    it('throws when user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      await expect(exportUserPersonalData('nonexistent')).rejects.toThrow('User not found');
    });
  });

  // ── runGdprMaintenanceJob ──────────────────────────────────────────────────
  describe('runGdprMaintenanceJob', () => {
    it('returns counts for tokens cleaned up and projects archived', async () => {
      const result = await runGdprMaintenanceJob();
      expect(result.tokensCleanedUp).toBe(4);   // from tokenRepository mock
      expect(result.projectsArchived).toBe(2);  // from project.updateMany mock
    });
  });
});
