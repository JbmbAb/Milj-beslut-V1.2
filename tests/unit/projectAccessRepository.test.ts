import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  projectMemberFindUnique: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
    },
    projectMember: {
      findUnique: mocks.projectMemberFindUnique,
    },
  },
}));

import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';

describe('assertProjectMembership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const baseInput = {
    projectId: 'proj-1',
    userId: 'user-1',
    organisationId: 'org-1',
  };

  it('succeeds when project is active, org matches, and membership exists', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue({ id: 'member-1' });

    await expect(assertProjectMembership(baseInput)).resolves.toBeUndefined();

    expect(mocks.projectFindUnique).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      select: { id: true, organisationId: true, status: true },
    });
    expect(mocks.projectMemberFindUnique).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: 'proj-1', userId: 'user-1' } },
      select: { id: true },
    });
  });

  it('throws when project does not exist', async () => {
    mocks.projectFindUnique.mockResolvedValue(null);

    await expect(assertProjectMembership(baseInput)).rejects.toThrow('Project not found');
    expect(mocks.projectMemberFindUnique).not.toHaveBeenCalled();
  });

  it('throws when organisationId does not match', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-OTHER',
      status: 'ACTIVE',
    });

    await expect(assertProjectMembership(baseInput)).rejects.toThrow(
      'Cross-organisation access denied'
    );
    expect(mocks.projectMemberFindUnique).not.toHaveBeenCalled();
  });

  it('throws when project status is not ACTIVE', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ARCHIVED',
    });

    await expect(assertProjectMembership(baseInput)).rejects.toThrow('Project is not active');
    expect(mocks.projectMemberFindUnique).not.toHaveBeenCalled();
  });

  it('throws when user is not a project member', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue(null);

    await expect(assertProjectMembership(baseInput)).rejects.toThrow(
      'User is not a member of this project'
    );
  });

  it('accepts an optional role parameter without affecting the logic', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue({ id: 'member-1' });

    await expect(
      assertProjectMembership({ ...baseInput, role: 'ADMIN' })
    ).resolves.toBeUndefined();
  });
});
