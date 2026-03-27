import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectPlanStateFindFirst: vi.fn(),
  projectPlanStateUpsert: vi.fn(),
  projectFindFirst: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    projectPlanState: {
      findFirst: mocks.projectPlanStateFindFirst,
      upsert: mocks.projectPlanStateUpsert,
    },
    project: {
      findFirst: mocks.projectFindFirst,
    },
  },
}));

import {
  getStoredProjectPlan,
  upsertStoredProjectPlan,
} from '../../server/repositories/projectPlanRepository';

describe('getStoredProjectPlan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the stored plan when a matching row exists', async () => {
    const fakePlan = { title: 'My Plan', sections: [] };
    mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: fakePlan });

    const result = await getStoredProjectPlan('proj-1', 'org-1');

    expect(result).toEqual(fakePlan);
    expect(mocks.projectPlanStateFindFirst).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', project: { organisationId: 'org-1' } },
      select: { plan: true },
    });
  });

  it('returns null when no row is found', async () => {
    mocks.projectPlanStateFindFirst.mockResolvedValue(null);

    const result = await getStoredProjectPlan('proj-1', 'org-1');

    expect(result).toBeNull();
  });

  it('returns null when the row exists but plan is null', async () => {
    mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: null });

    const result = await getStoredProjectPlan('proj-1', 'org-1');

    expect(result).toBeNull();
  });

  it('returns null when the row plan is not an object (e.g. a string)', async () => {
    mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: 'invalid' });

    const result = await getStoredProjectPlan('proj-1', 'org-1');

    expect(result).toBeNull();
  });
});

describe('upsertStoredProjectPlan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const fakePlan = { title: 'Plan A', sections: [] } as any;
  const baseInput = {
    projectId: 'proj-1',
    organisationId: 'org-1',
    schemaVersion: 2,
    plan: fakePlan,
  };

  it('upserts the plan when the project exists and belongs to the organisation', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1' });
    const upsertResult = { projectId: 'proj-1', schemaVersion: 2, plan: fakePlan };
    mocks.projectPlanStateUpsert.mockResolvedValue(upsertResult);

    const result = await upsertStoredProjectPlan(baseInput);

    expect(mocks.projectFindFirst).toHaveBeenCalledWith({
      where: { id: 'proj-1', organisationId: 'org-1' },
    });
    expect(mocks.projectPlanStateUpsert).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
      create: { projectId: 'proj-1', schemaVersion: 2, plan: fakePlan },
      update: { schemaVersion: 2, plan: fakePlan },
    });
    expect(result).toEqual(upsertResult);
  });

  it('throws when the project is not found or belongs to another organisation', async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(upsertStoredProjectPlan(baseInput)).rejects.toThrow(
      'Project not found or access denied'
    );
    expect(mocks.projectPlanStateUpsert).not.toHaveBeenCalled();
  });
});
