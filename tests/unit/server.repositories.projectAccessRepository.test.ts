import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';
import { prisma } from '../../server/db/prisma';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
    },
  },
}));

describe('server/repositories/projectAccessRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertProjectMembership', () => {
    it('allows access for valid project member', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org1',
        status: 'ACTIVE',
      } as any);

      vi.mocked(prisma.projectMember.findUnique).mockResolvedValue({
        id: 'member1',
      } as any);

      await expect(assertProjectMembership(input)).resolves.not.toThrow();
    });

    it('throws when project not found', async () => {
      const input = {
        projectId: 'nonexistent',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow('Project not found');
    });

    it('throws on cross-organisation access attempt', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org2',
        status: 'ACTIVE',
      } as any);

      await expect(assertProjectMembership(input)).rejects.toThrow('Cross-organisation access denied');
    });

    it('throws when project is not active', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org1',
        status: 'ARCHIVED',
      } as any);

      await expect(assertProjectMembership(input)).rejects.toThrow('Project is not active');
    });

    it('throws when user is not project member', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org1',
        status: 'ACTIVE',
      } as any);

      vi.mocked(prisma.projectMember.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow('User is not a member of this project');
    });

    it('enforces membership even for admin users', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'admin1',
        organisationId: 'org1',
        role: 'ADMIN' as const,
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org1',
        status: 'ACTIVE',
      } as any);

      vi.mocked(prisma.projectMember.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow('User is not a member of this project');
    });

    it('validates multiple projects independently', async () => {
      const input1 = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };
      const input2 = {
        projectId: 'proj2',
        userId: 'user2',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique)
        .mockResolvedValueOnce({
          id: 'proj1',
          organisationId: 'org1',
          status: 'ACTIVE',
        } as any)
        .mockResolvedValueOnce({
          id: 'proj2',
          organisationId: 'org1',
          status: 'ACTIVE',
        } as any);

      vi.mocked(prisma.projectMember.findUnique)
        .mockResolvedValueOnce({ id: 'member1' } as any)
        .mockResolvedValueOnce({ id: 'member2' } as any);

      await expect(assertProjectMembership(input1)).resolves.not.toThrow();
      await expect(assertProjectMembership(input2)).resolves.not.toThrow();
      expect(prisma.project.findUnique).toHaveBeenCalledTimes(2);
    });

    it('handles database errors', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockRejectedValue(new Error('Database connection error'));

      await expect(assertProjectMembership(input)).rejects.toThrow('Database connection error');
    });

    it('handles database errors during membership check', async () => {
      const input = {
        projectId: 'proj1',
        userId: 'user1',
        organisationId: 'org1',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org1',
        status: 'ACTIVE',
      } as any);

      vi.mocked(prisma.projectMember.findUnique).mockRejectedValue(new Error('Membership lookup failed'));

      await expect(assertProjectMembership(input)).rejects.toThrow('Membership lookup failed');
    });

    it('handles very long ID strings', async () => {
      const input = {
        projectId: 'proj-' + 'x'.repeat(10000),
        userId: 'user-' + 'y'.repeat(10000),
        organisationId: 'org-' + 'z'.repeat(10000),
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow('Project not found');
    });

    it('handles special characters in IDs', async () => {
      const input = {
        projectId: 'proj!@#$%^&*()',
        userId: 'user!@#$%',
        organisationId: 'org!@#$',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow('Project not found');
    });

    it('handles various inactive project statuses', async () => {
      const statuses = ['ARCHIVED', 'DELETED', 'SUSPENDED', 'INACTIVE'];

      for (const status of statuses) {
        vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
          id: 'proj1',
          organisationId: 'org1',
          status,
        } as any);

        const input = {
          projectId: 'proj1',
          userId: 'user1',
          organisationId: 'org1',
        };

        await expect(assertProjectMembership(input)).rejects.toThrow('Project is not active');
      }
    });

    it('handles empty string IDs', async () => {
      const input = {
        projectId: '',
        userId: '',
        organisationId: '',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow();
    });

    it('handles unicode characters in IDs', async () => {
      const input = {
        projectId: 'proj-åäö',
        userId: 'user-©2026',
        organisationId: 'org-ñ',
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

      await expect(assertProjectMembership(input)).rejects.toThrow();
    });

    it('validates multiple concurrent access attempts', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'proj1',
        organisationId: 'org1',
        status: 'ACTIVE',
      } as any);

      vi.mocked(prisma.projectMember.findUnique).mockResolvedValue({ id: 'member1' } as any);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          assertProjectMembership({
            projectId: 'proj1',
            userId: `user${i}`,
            organisationId: 'org1',
          }),
        );
      }

      await expect(Promise.all(promises)).resolves.toBeDefined();
      expect(prisma.project.findUnique).toHaveBeenCalledTimes(10);
    });
  });
});
