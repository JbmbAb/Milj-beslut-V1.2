import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  projectPlanState: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import {
  getStoredProjectPlan,
  upsertStoredProjectPlan,
} from '../../server/repositories/projectPlanRepository';

describe('projectPlanRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no stored plan exists or when plan is not an object', async () => {
    prisma.projectPlanState.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ plan: 'not-an-object' });

    await expect(getStoredProjectPlan('project-1', 'org-1')).resolves.toBeNull();
    await expect(getStoredProjectPlan('project-1', 'org-1')).resolves.toBeNull();

    expect(prisma.projectPlanState.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        project: { organisationId: 'org-1' },
      },
      select: { plan: true },
    });
  });

  it('returns stored plan objects', async () => {
    prisma.projectPlanState.findFirst.mockResolvedValue({
      plan: { name: 'Stored plan', stageGates: [] },
    });

    await expect(getStoredProjectPlan('project-2', 'org-2')).resolves.toEqual({
      name: 'Stored plan',
      stageGates: [],
    });
  });

  it('throws when upserting a plan for an inaccessible project', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      upsertStoredProjectPlan({
        projectId: 'project-3',
        organisationId: 'org-3',
        schemaVersion: 2,
        plan: { name: 'Plan' } as never,
      }),
    ).rejects.toThrow('Project not found or access denied');
  });

  it('upserts stored plans for accessible projects', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-4' });
    prisma.projectPlanState.upsert.mockResolvedValue({ id: 'plan-state-1' });

    const plan = { name: 'Plan 4', location: { propertyId: 'Orsa 1:1' } } as never;

    await expect(
      upsertStoredProjectPlan({
        projectId: 'project-4',
        organisationId: 'org-4',
        schemaVersion: 3,
        plan,
      }),
    ).resolves.toEqual({ id: 'plan-state-1' });

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-4', organisationId: 'org-4' },
    });
    expect(prisma.projectPlanState.upsert).toHaveBeenCalledWith({
      where: { projectId: 'project-4' },
      create: {
        projectId: 'project-4',
        schemaVersion: 3,
        plan,
      },
      update: {
        schemaVersion: 3,
        plan,
      },
    });
  });
});
