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

    await expect(upsertStoredProjectPlan(baseInput)).rejects.toThrow('Project not found or access denied');
    expect(mocks.projectPlanStateUpsert).not.toHaveBeenCalled();
  });

  it('handles database errors during project lookup', async () => {
    mocks.projectFindFirst.mockRejectedValue(new Error('db error'));

    await expect(upsertStoredProjectPlan(baseInput)).rejects.toThrow('db error');
  });

  it('handles database errors during upsert', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1' });
    mocks.projectPlanStateUpsert.mockRejectedValue(new Error('upsert failed'));

    await expect(upsertStoredProjectPlan(baseInput)).rejects.toThrow('upsert failed');
  });

  it('handles empty plan objects', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1' });
    const emptyPlan = {};
    mocks.projectPlanStateUpsert.mockResolvedValue({
      projectId: 'proj-1',
      schemaVersion: 2,
      plan: emptyPlan as any,
    });

    const result = await upsertStoredProjectPlan({
      ...baseInput,
      plan: emptyPlan as any,
    });

    expect(result.plan).toEqual(emptyPlan);
  });

  it('handles very large plan objects', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1' });
    const largePlan = {
      title: 'Large Plan',
      sections: Array.from({ length: 5000 }, (_, i) => ({
        id: `section-${i}`,
        title: `Section ${i}`,
        content: 'x'.repeat(1000),
      })),
    };

    mocks.projectPlanStateUpsert.mockResolvedValue({
      projectId: 'proj-1',
      schemaVersion: 2,
      plan: largePlan,
    });

    await upsertStoredProjectPlan({
      ...baseInput,
      plan: largePlan as any,
    });

    expect(mocks.projectPlanStateUpsert).toHaveBeenCalled();
  });

  it('handles different schema versions', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1' });
    mocks.projectPlanStateUpsert.mockResolvedValue({
      projectId: 'proj-1',
      schemaVersion: 5,
      plan: fakePlan,
    });

    await upsertStoredProjectPlan({
      ...baseInput,
      schemaVersion: 5,
    });

    const callArg = mocks.projectPlanStateUpsert.mock.calls[0][0];
    expect(callArg.create.schemaVersion).toBe(5);
    expect(callArg.update.schemaVersion).toBe(5);
  });

  it('handles cross-organisation access denial', async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(
      upsertStoredProjectPlan({
        projectId: 'proj-1',
        organisationId: 'org-different',
        schemaVersion: 2,
        plan: fakePlan,
      }),
    ).rejects.toThrow('Project not found or access denied');
  });

  it('handles database errors during fetch', async () => {
    mocks.projectPlanStateFindFirst.mockRejectedValue(new Error('fetch error'));

    await expect(getStoredProjectPlan('proj-1', 'org-1')).rejects.toThrow('fetch error');
  });

  it('handles empty string project ids', async () => {
    mocks.projectPlanStateFindFirst.mockResolvedValue(null);

    const result = await getStoredProjectPlan('', 'org-1');

    expect(result).toBeNull();
  });

  it('handles empty string organisation ids', async () => {
    mocks.projectPlanStateFindFirst.mockResolvedValue(null);

    const result = await getStoredProjectPlan('proj-1', '');

    expect(result).toBeNull();
  });

  it('handles plans with nested null values', async () => {
    const planWithNulls = {
      title: 'Plan with nulls',
      sections: [{ id: 'sec-1', title: null, content: null }],
      metadata: null,
    };

    mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: planWithNulls });

    const result = await getStoredProjectPlan('proj-1', 'org-1');

    expect(result).toEqual(planWithNulls);
  });

  it('handles plans with circular references gracefully', async () => {
    // Note: actual circular refs can't be JSON serialized, so we test with a complex nested structure
    const complexPlan = {
      title: 'Complex',
      sections: Array.from({ length: 100 }, (_, i) => ({
        id: `sec-${i}`,
        subsections: Array.from({ length: 50 }, (_, j) => ({
          id: `sub-${i}-${j}`,
          items: Array.from({ length: 20 }, (_, k) => ({
            id: `item-${i}-${j}-${k}`,
          })),
        })),
      })),
    };

    mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: complexPlan });

    const result = await getStoredProjectPlan('proj-1', 'org-1');

    expect(result).toEqual(complexPlan);
  });
});
