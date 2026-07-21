import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredPlanRow = { plan: unknown } | null;

const state = vi.hoisted(() => {
  const rowHolder = { row: null as StoredPlanRow };
  const projectPlanStateFindUnique = vi.fn(async () => rowHolder.row);
  const projectPlanStateUpsert = vi.fn(
    async (args: { create: { plan: unknown }; update: { plan: unknown } }) => {
      rowHolder.row = { plan: rowHolder.row ? args.update.plan : args.create.plan };
      return rowHolder.row;
    },
  );
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({
      projectPlanState: {
        findUnique: projectPlanStateFindUnique,
        upsert: projectPlanStateUpsert,
      },
    }),
  );

  return {
    rowHolder,
    projectPlanStateFindUnique,
    projectPlanStateUpsert,
    transaction,
  };
});

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    projectPlanState: {
      findUnique: state.projectPlanStateFindUnique,
      upsert: state.projectPlanStateUpsert,
    },
    $transaction: state.transaction,
  },
}));

import {
  adjustMassVolume,
  createStorageArea,
  listStorageAreasForProject,
} from '../../server/repositories/storageAreaRepository';

describe('storageAreaRepository', () => {
  beforeEach(() => {
    state.rowHolder.row = null;
    vi.clearAllMocks();
  });

  it('creates and lists storage areas via project plan state', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Mellanlager A',
      capacityM3: 120,
      description: 'Asfalt och jord',
    });

    expect(created.projectId).toBe('project-1');
    expect(created.name).toBe('Mellanlager A');
    expect(created.capacityM3).toBe(120);
    expect(created.contents).toEqual({});

    const listed = await listStorageAreasForProject('project-1');
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
  });

  it('rejects duplicate storage area names within a project', async () => {
    await createStorageArea({
      projectId: 'project-1',
      name: 'Yta B',
      capacityM3: 40,
    });

    await expect(
      createStorageArea({
        projectId: 'project-1',
        name: 'yta b',
        capacityM3: 20,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('adjusts storage area contents and removes exhausted mass rows', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta C',
      capacityM3: 200,
    });

    const increased = await adjustMassVolume('project-1', created.id, '17 05 04', 50.25);
    expect(increased.contents).toEqual({
      '17 05 04': 50.25,
    });

    const cleared = await adjustMassVolume('project-1', created.id, '17 05 04', -50.25);
    expect(cleared.contents).toEqual({});
  });

  it('handles transaction errors during creation', async () => {
    state.transaction.mockRejectedValueOnce(new Error('transaction failed'));

    await expect(
      createStorageArea({
        projectId: 'project-1',
        name: 'Yta D',
        capacityM3: 300,
      }),
    ).rejects.toThrow('transaction failed');
  });

  it('handles transaction errors during mass adjustment', async () => {
    state.transaction.mockRejectedValueOnce(new Error('transaction failed'));

    await expect(adjustMassVolume('project-1', 'area-1', '17 05 04', 100)).rejects.toThrow(
      'transaction failed',
    );
  });

  it('handles very large capacity values', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Large',
      capacityM3: 999999999,
    });

    expect(created.capacityM3).toBe(999999999);
  });

  it('handles very small capacity values', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Tiny',
      capacityM3: 0.001,
    });

    expect(created.capacityM3).toBe(0.001);
  });

  it('handles decimal mass volumes', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Decimal',
      capacityM3: 100,
    });

    const result = await adjustMassVolume('project-1', created.id, '17 05 04', 33.333333);
    expect(result.contents['17 05 04']).toBeCloseTo(33.333, 3);
  });

  it('handles multiple mass types in single storage area', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Multi',
      capacityM3: 500,
    });

    await adjustMassVolume('project-1', created.id, '17 05 04', 50);
    await adjustMassVolume('project-1', created.id, '17 09 03', 75);
    const result = await adjustMassVolume('project-1', created.id, '17 05 05', 100);

    expect(Object.keys(result.contents)).toHaveLength(3);
  });

  it('handles empty storage areas for projects', async () => {
    const list = await listStorageAreasForProject('project-empty');
    expect(list).toEqual([]);
  });

  it('handles Swedish names for storage areas', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Uppsamlingsplats för återvunnet material',
      capacityM3: 200,
      description: 'Förpackningsavfall och papper',
    });

    expect(created.name).toContain('Uppsamlingsplats');
  });

  it('handles special characters in mass codes', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Special',
      capacityM3: 100,
    });

    const result = await adjustMassVolume('project-1', created.id, '17-05-04*', 50);
    expect(Object.keys(result.contents)[0]).toContain('17-05-04');
  });

  it('handles concurrent adjustments to same storage area', async () => {
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Concurrent',
      capacityM3: 500,
    });

    await Promise.all([
      adjustMassVolume('project-1', created.id, '17 05 04', 100),
      adjustMassVolume('project-1', created.id, '17 09 03', 150),
      adjustMassVolume('project-1', created.id, '17 05 05', 200),
    ]);

    const result = await listStorageAreasForProject('project-1');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles very long description text', async () => {
    const longDesc = 'A'.repeat(10000);
    const created = await createStorageArea({
      projectId: 'project-1',
      name: 'Yta Long Desc',
      capacityM3: 100,
      description: longDesc,
    });

    expect(created.description).toContain('A');
  });
});
