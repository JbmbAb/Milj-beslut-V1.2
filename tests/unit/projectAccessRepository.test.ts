import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectMember: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';

describe('projectAccessRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the project does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(
      assertProjectMembership({
        projectId: 'project-1',
        userId: 'user-1',
        organisationId: 'org-1',
      }),
    ).rejects.toThrow('Project not found');

    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      select: {
        id: true,
        organisationId: true,
        status: true,
      },
    });
  });

  it('throws on cross-organisation access', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      organisationId: 'org-2',
      status: 'ACTIVE',
    });

    await expect(
      assertProjectMembership({
        projectId: 'project-1',
        userId: 'user-1',
        organisationId: 'org-1',
        role: 'ADMIN',
      }),
    ).rejects.toThrow('Cross-organisation access denied');
  });

  it('throws when the project is not active', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      organisationId: 'org-1',
      status: 'ARCHIVED',
    });

    await expect(
      assertProjectMembership({
        projectId: 'project-1',
        userId: 'user-1',
        organisationId: 'org-1',
      }),
    ).rejects.toThrow('Project is not active');
  });

  it('throws when the user lacks explicit project membership', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    prisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(
      assertProjectMembership({
        projectId: 'project-1',
        userId: 'user-1',
        organisationId: 'org-1',
      }),
    ).rejects.toThrow('User is not a member of this project');

    expect(prisma.projectMember.findUnique).toHaveBeenCalledWith({
      where: {
        projectId_userId: {
          projectId: 'project-1',
          userId: 'user-1',
        },
      },
      select: { id: true },
    });
  });

  it('resolves when the project is active and the user is a member', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    prisma.projectMember.findUnique.mockResolvedValue({ id: 'member-1' });

    await expect(
      assertProjectMembership({
        projectId: 'project-1',
        userId: 'user-1',
        organisationId: 'org-1',
        role: 'CONSULTANT',
      }),
    ).resolves.toBeUndefined();
  });
});
