import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  projectMemberCount: vi.fn(),
  projectMemberDelete: vi.fn(),
  projectMemberFindFirst: vi.fn(),
  projectMemberFindMany: vi.fn(),
  projectMemberFindUnique: vi.fn(),
  projectMemberUpsert: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
    },
    projectMember: {
      count: mocks.projectMemberCount,
      delete: mocks.projectMemberDelete,
      findFirst: mocks.projectMemberFindFirst,
      findMany: mocks.projectMemberFindMany,
      findUnique: mocks.projectMemberFindUnique,
      upsert: mocks.projectMemberUpsert,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}));

import {
  isValidRole,
  listProjectMembers,
  removeProjectMember,
  upsertProjectMember,
} from '../../server/services/projectMemberService';

describe('projectMemberService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates supported project roles', () => {
    expect(isValidRole('OWNER')).toBe(true);
    expect(isValidRole('AUDITOR')).toBe(true);
    expect(isValidRole('ADMIN')).toBe(false);
    expect(isValidRole(null)).toBe(false);
  });

  it('lists project members with bankid ids and iso timestamps', async () => {
    mocks.projectMemberFindMany.mockResolvedValueOnce([
      {
        id: 'member-1',
        userId: 'user-1',
        accessRole: 'OWNER',
        createdAt: new Date('2026-03-21T12:00:00.000Z'),
        user: {
          id: 'user-1',
          bankidId: '191212121212',
        },
      },
    ]);

    const result = await listProjectMembers('project-1');

    expect(result).toEqual([
      {
        id: 'member-1',
        userId: 'user-1',
        bankidId: '191212121212',
        accessRole: 'OWNER',
        createdAt: '2026-03-21T12:00:00.000Z',
      },
    ]);
    expect(mocks.projectMemberFindMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      include: {
        user: {
          select: {
            id: true,
            bankidId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('rejects upserts for missing or inactive projects', async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(null);

    await expect(
      upsertProjectMember({
        projectId: 'project-1',
        targetBankidId: '191212121212',
        role: 'OWNER',
        actingUserId: 'admin-1',
      }),
    ).rejects.toThrow(/project not found/i);

    mocks.projectFindUnique.mockResolvedValueOnce({
      id: 'project-1',
      organisationId: 'org-1',
      status: 'ARCHIVED',
    });

    await expect(
      upsertProjectMember({
        projectId: 'project-1',
        targetBankidId: '191212121212',
        role: 'OWNER',
        actingUserId: 'admin-1',
      }),
    ).rejects.toThrow(/project is not active/i);
  });

  it('rejects missing users and cross-organisation assignments', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'project-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.userFindUnique.mockResolvedValueOnce(null);

    await expect(
      upsertProjectMember({
        projectId: 'project-1',
        targetBankidId: '191212121212',
        role: 'CONTRIBUTOR',
        actingUserId: 'admin-1',
      }),
    ).rejects.toThrow(/user '191212121212' not found/i);

    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user-2',
      bankidId: '191212121212',
      organisationId: 'org-2',
    });

    await expect(
      upsertProjectMember({
        projectId: 'project-1',
        targetBankidId: '191212121212',
        role: 'CONTRIBUTOR',
        actingUserId: 'admin-1',
      }),
    ).rejects.toThrow(/cross-organisation member assignment denied/i);
  });

  it('upserts project members and maps the saved record', async () => {
    mocks.projectFindUnique.mockResolvedValueOnce({
      id: 'project-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user-2',
      bankidId: '191212121212',
      organisationId: 'org-1',
    });
    mocks.projectMemberUpsert.mockResolvedValueOnce({
      id: 'member-2',
      userId: 'user-2',
      accessRole: 'REVIEWER',
      createdAt: new Date('2026-03-21T13:00:00.000Z'),
      user: {
        id: 'user-2',
        bankidId: '191212121212',
      },
    });

    const result = await upsertProjectMember({
      projectId: 'project-1',
      targetBankidId: '191212121212',
      role: 'REVIEWER',
      actingUserId: 'admin-1',
    });

    expect(mocks.projectMemberUpsert).toHaveBeenCalledWith({
      where: {
        projectId_userId: {
          projectId: 'project-1',
          userId: 'user-2',
        },
      },
      create: {
        projectId: 'project-1',
        userId: 'user-2',
        accessRole: 'REVIEWER',
      },
      update: {
        accessRole: 'REVIEWER',
      },
      include: {
        user: { select: { id: true, bankidId: true } },
      },
    });
    expect(result).toEqual({
      id: 'member-2',
      userId: 'user-2',
      bankidId: '191212121212',
      accessRole: 'REVIEWER',
      createdAt: '2026-03-21T13:00:00.000Z',
    });
  });

  it('rejects removals for missing members or mismatched projects', async () => {
    mocks.projectMemberFindUnique.mockResolvedValueOnce(null);

    await expect(
      removeProjectMember({
        projectId: 'project-1',
        memberId: 'member-1',
        actingUserId: 'admin-1',
      }),
    ).rejects.toThrow(/member not found/i);

    mocks.projectMemberFindUnique.mockResolvedValueOnce({
      id: 'member-1',
      projectId: 'project-2',
      userId: 'user-1',
    });

    await expect(
      removeProjectMember({
        projectId: 'project-1',
        memberId: 'member-1',
        actingUserId: 'admin-1',
      }),
    ).rejects.toThrow(/does not belong to this project/i);
  });

  it('blocks removing the last owner and self-removal', async () => {
    mocks.projectMemberFindUnique.mockResolvedValueOnce({
      id: 'member-1',
      projectId: 'project-1',
      userId: 'user-1',
    });
    mocks.projectMemberCount.mockResolvedValueOnce(1);
    mocks.projectMemberFindFirst.mockResolvedValueOnce({ id: 'member-1' });

    await expect(
      removeProjectMember({
        projectId: 'project-1',
        memberId: 'member-1',
        actingUserId: 'admin-2',
      }),
    ).rejects.toThrow(/last OWNER/i);

    mocks.projectMemberFindUnique.mockResolvedValueOnce({
      id: 'member-2',
      projectId: 'project-1',
      userId: 'admin-2',
    });
    mocks.projectMemberCount.mockResolvedValueOnce(2);
    mocks.projectMemberFindFirst.mockResolvedValueOnce(null);

    await expect(
      removeProjectMember({
        projectId: 'project-1',
        memberId: 'member-2',
        actingUserId: 'admin-2',
      }),
    ).rejects.toThrow(/cannot remove yourself/i);
  });

  it('deletes non-owner members from the correct project', async () => {
    mocks.projectMemberFindUnique.mockResolvedValueOnce({
      id: 'member-3',
      projectId: 'project-1',
      userId: 'user-3',
    });
    mocks.projectMemberCount.mockResolvedValueOnce(2);
    mocks.projectMemberFindFirst.mockResolvedValueOnce(null);
    mocks.projectMemberDelete.mockResolvedValueOnce({ id: 'member-3' });

    await removeProjectMember({
      projectId: 'project-1',
      memberId: 'member-3',
      actingUserId: 'admin-1',
    });

    expect(mocks.projectMemberDelete).toHaveBeenCalledWith({
      where: { id: 'member-3' },
    });
  });
});
