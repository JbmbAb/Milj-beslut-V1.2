import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn((cb) => cb(prisma)),
    project: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
    documentRecord: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    documentContent: { updateMany: vi.fn(), deleteMany: vi.fn() },
    documentChunk: { updateMany: vi.fn(), deleteMany: vi.fn() },
    requirementRecord: { updateMany: vi.fn(), deleteMany: vi.fn() },
    requirementCitation: { deleteMany: vi.fn(), updateMany: vi.fn() },
    requirementCase: { deleteMany: vi.fn() },
    projectPlanState: { deleteMany: vi.fn() },
    projectMember: { findMany: vi.fn(), deleteMany: vi.fn() },
    propertyAccessLog: { updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    searchQueryLog: { updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    caseNote: { updateMany: vi.fn(), findMany: vi.fn() },
    auditTrail: { updateMany: vi.fn() },
    tokenRevocation: { deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  cleanupExpiredTokenRevocations: vi.fn(),
}));

vi.mock('../../server/services/documentObjectStorage', () => ({
  deleteStorageFile: vi.fn(),
}));

import { prisma } from '../../server/db/prisma';
import { cleanupExpiredTokenRevocations } from '../../server/repositories/tokenRepository';
import { deleteStorageFile } from '../../server/services/documentObjectStorage';
import {
  setProjectRetentionPolicy,
  archiveExpiredProjects,
  permanentlyDeleteProjectData,
  scrubProjectData,
  permanentlyDeleteUserData,
  getUserDataExport,
  runGdprMaintenanceJob,
} from '../../server/services/gdprComplianceService';

describe('gdprComplianceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setProjectRetentionPolicy', () => {
    it('uppdaterar retentionUntil för ett projekt', async () => {
      const projectId = 'p123';
      const retentionDays = 30;

      await setProjectRetentionPolicy(projectId, retentionDays);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: {
          retentionUntil: expect.any(Date),
        },
      });
    });
  });

  describe('archiveExpiredProjects', () => {
    it('markerar utgångna projekt som ARCHIVED', async () => {
      vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 5 });

      const count = await archiveExpiredProjects();

      expect(count).toBe(5);
      expect(prisma.project.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'CLOSED',
          retentionUntil: {
            lt: expect.any(Date),
          },
        },
        data: {
          status: 'ARCHIVED',
        },
      });
    });
  });

  describe('permanentlyDeleteProjectData', () => {
    it('raderar alla relaterade data för ett projekt', async () => {
      const projectId = 'p123';
      const mockProject = {
        id: projectId,
        documents: [
          { id: 'd1', absolutePath: '/tmp/f1.pdf' },
          { id: 'd2', absolutePath: null },
        ],
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject as any);

      await permanentlyDeleteProjectData(projectId);

      expect(prisma.requirementRecord.deleteMany).toHaveBeenCalledWith({ where: { projectId } });
      expect(prisma.documentRecord.deleteMany).toHaveBeenCalledWith({ where: { projectId } });
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: projectId } });
    });

    it('returns early when project is already missing', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await permanentlyDeleteProjectData('missing-project');

      expect(prisma.project.delete).not.toHaveBeenCalled();
      expect(prisma.documentRecord.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('scrubProjectData', () => {
    it('anonymiserar data utan att radera rader (förutom filer)', async () => {
      const projectId = 'p123';
      const mockProject = {
        id: projectId,
        documents: [{ id: 'd1', absolutePath: '/tmp/f1.pdf' }],
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject as any);

      await scrubProjectData(projectId);

      expect(prisma.documentContent.updateMany).toHaveBeenCalled();
      expect(prisma.documentRecord.updateMany).toHaveBeenCalledWith({
        where: { projectId },
        data: expect.objectContaining({ subject: '[SCRUBBED]' }),
      });
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: expect.objectContaining({ propertyDesignation: 'SCRUBBED_PROJECT' }),
      });
    });

    it('returns early when scrubbing a missing project', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await scrubProjectData('missing-project');

      expect(prisma.documentContent.updateMany).not.toHaveBeenCalled();
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('skips storage deletion when scrubbed documents lack absolute paths', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'p124',
        documents: [{ id: 'd2', absolutePath: null }],
      } as any);

      await scrubProjectData('p124');

      expect(deleteStorageFile).not.toHaveBeenCalled();
    });
  });

  describe('permanentlyDeleteUserData', () => {
    it('raderar en användare och alla ägda projekt via transaktion', async () => {
      const userId = 'u123';
      vi.mocked(prisma.projectMember.findMany).mockResolvedValue([{ projectId: 'p1' }] as any);
      vi.mocked(prisma.auditTrail.updateMany).mockResolvedValue({ count: 10 });
      vi.mocked(prisma.tokenRevocation.deleteMany).mockResolvedValue({ count: 2 });

      const result = await permanentlyDeleteUserData(userId);

      expect(result.projectsDeleted).toBe(1);
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: userId } });
      expect(prisma.auditTrail.updateMany).toHaveBeenCalledWith({
        where: { userId },
        data: { userId: null },
      });
    });
  });

  describe('getUserDataExport', () => {
    it('returnerar en samling av användardata', async () => {
      const userId = 'u123';
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: userId, organisationId: 'o1' } as any);
      vi.mocked(prisma.projectMember.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.propertyAccessLog.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.searchQueryLog.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.caseNote.findMany).mockResolvedValue([] as any);

      const data = await getUserDataExport(userId);

      expect(data.user.id).toBe(userId);
      expect(data.projects).toEqual([]);
    });

    it('kastar fel om användaren inte hittas', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      await expect(getUserDataExport('invalid')).rejects.toThrow('User not found');
    });
  });

  describe('runGdprMaintenanceJob', () => {
    it('kör alla underhållssteg', async () => {
      vi.mocked(cleanupExpiredTokenRevocations).mockResolvedValue(3);
      vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 'p_purge' }] as any);
      vi.mocked(prisma.project.delete).mockResolvedValue({} as any);

      const result = await runGdprMaintenanceJob();

      expect(result.tokensCleanedUp).toBe(3);
      expect(result.projectsArchived).toBe(2);
      expect(result.projectsPurged).toBe(1);
    });

    it('hanterar inga utgångna projekt att tömma', async () => {
      vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.project.findMany).mockResolvedValue([] as any);

      const result = await runGdprMaintenanceJob();

      expect(result.projectsPurged).toBe(0);
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });
  });
});
