import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectPlan } from '../../types';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

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

// ─── Minimal ProjectPlan stub ─────────────────────────────────────────────────

function makePlan(): Partial<ProjectPlan> {
  return {
    name: 'Test Plan',
    revision: '1.0',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('projectPlanRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getStoredProjectPlan ──────────────────────────────────────────────────

  describe('getStoredProjectPlan', () => {
    it('returns the plan from a matching row', async () => {
      const plan = makePlan();
      mocks.projectPlanStateFindFirst.mockResolvedValue({ plan });

      const result = await getStoredProjectPlan('proj-1', 'org-1');

      expect(result).toEqual(plan);
      expect(mocks.projectPlanStateFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'proj-1', project: { organisationId: 'org-1' } },
        }),
      );
    });

    it('returns null when no row exists', async () => {
      mocks.projectPlanStateFindFirst.mockResolvedValue(null);

      const result = await getStoredProjectPlan('proj-missing', 'org-1');

      expect(result).toBeNull();
    });

    it('returns null when row.plan is not an object', async () => {
      mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: 'bad-string' });

      const result = await getStoredProjectPlan('proj-1', 'org-1');

      expect(result).toBeNull();
    });

    it('returns null when row.plan is null', async () => {
      mocks.projectPlanStateFindFirst.mockResolvedValue({ plan: null });

      const result = await getStoredProjectPlan('proj-1', 'org-1');

      expect(result).toBeNull();
    });
  });

  // ── upsertStoredProjectPlan ───────────────────────────────────────────────

  describe('upsertStoredProjectPlan', () => {
    it('upserts the plan when project exists', async () => {
      mocks.projectFindFirst.mockResolvedValue({ id: 'proj-1' });
      mocks.projectPlanStateUpsert.mockResolvedValue({ projectId: 'proj-1' });

      const plan = makePlan();
      await upsertStoredProjectPlan({
        projectId: 'proj-1',
        organisationId: 'org-1',
        schemaVersion: 2,
        plan: plan as ProjectPlan,
      });

      expect(mocks.projectPlanStateUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'proj-1' },
          create: expect.objectContaining({ projectId: 'proj-1', schemaVersion: 2, plan }),
          update: expect.objectContaining({ schemaVersion: 2, plan }),
        }),
      );
    });

    it('throws when project does not exist', async () => {
      mocks.projectFindFirst.mockResolvedValue(null);

      await expect(
        upsertStoredProjectPlan({
          projectId: 'proj-missing',
          organisationId: 'org-1',
          schemaVersion: 1,
          plan: makePlan() as ProjectPlan,
        }),
      ).rejects.toThrow('Project not found or access denied');

      expect(mocks.projectPlanStateUpsert).not.toHaveBeenCalled();
    });

    it('enforces organisationId in project lookup', async () => {
      mocks.projectFindFirst.mockResolvedValue(null);

      await expect(
        upsertStoredProjectPlan({
          projectId: 'proj-1',
          organisationId: 'org-SECURE',
          schemaVersion: 1,
          plan: makePlan() as ProjectPlan,
        }),
      ).rejects.toThrow();

      expect(mocks.projectFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-1', organisationId: 'org-SECURE' },
        }),
      );
    });
  });
});
