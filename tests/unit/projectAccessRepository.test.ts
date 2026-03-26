import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

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

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<Parameters<typeof assertProjectMembership>[0]> = {}) {
  return {
    projectId: 'proj-1',
    userId: 'user-1',
    organisationId: 'org-1',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('projectAccessRepository – assertProjectMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves without error for a valid member', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue({ id: 'member-1' });

    await expect(assertProjectMembership(makeInput())).resolves.toBeUndefined();
  });

  it('throws when project does not exist', async () => {
    mocks.projectFindUnique.mockResolvedValue(null);

    await expect(assertProjectMembership(makeInput())).rejects.toThrow('Project not found');
  });

  it('throws on cross-organisation access (security)', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-OTHER',
      status: 'ACTIVE',
    });

    await expect(assertProjectMembership(makeInput({ organisationId: 'org-1' }))).rejects.toThrow(
      'Cross-organisation access denied',
    );

    // projectMember must NOT be queried if org check fails
    expect(mocks.projectMemberFindUnique).not.toHaveBeenCalled();
  });

  it('throws when project is not active', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ARCHIVED',
    });

    await expect(assertProjectMembership(makeInput())).rejects.toThrow('Project is not active');

    expect(mocks.projectMemberFindUnique).not.toHaveBeenCalled();
  });

  it('throws when user is not a project member', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue(null);

    await expect(assertProjectMembership(makeInput())).rejects.toThrow(
      'User is not a member of this project',
    );
  });

  it('ADMINs are NOT exempt from membership check (security)', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue(null);

    // Even an ADMIN role must have explicit membership
    await expect(
      assertProjectMembership(makeInput({ role: 'ADMIN' })),
    ).rejects.toThrow('User is not a member of this project');
  });

  it('queries projectMember with composite key', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'proj-1',
      organisationId: 'org-1',
      status: 'ACTIVE',
    });
    mocks.projectMemberFindUnique.mockResolvedValue({ id: 'member-1' });

    await assertProjectMembership(makeInput({ projectId: 'proj-1', userId: 'user-1' }));

    expect(mocks.projectMemberFindUnique).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: 'proj-1', userId: 'user-1' } },
      select: { id: true },
    });
  });
});
