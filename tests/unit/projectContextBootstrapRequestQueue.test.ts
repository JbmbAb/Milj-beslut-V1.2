import { describe, expect, it, vi, beforeEach } from 'vitest';

const { create, findFirst, findUnique, updateMany, update } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    projectContextBootstrapRequest: { create, findFirst, findUnique, updateMany, update },
  },
}));

import {
  enqueueProjectContextBootstrapRequest,
  leaseOnePendingBootstrapRequest,
  markBootstrapRequestCompleted,
  markBootstrapRequestFailed,
} from '../../server/modules/localization/projectContextBootstrapRequestQueue';

describe('PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B: bootstrap request queue', () => {
  beforeEach(() => {
    create.mockReset();
    findFirst.mockReset();
    findUnique.mockReset();
    updateMany.mockReset();
    update.mockReset();
  });

  it('enqueue never accepts an artifact ref, issuer ref, or signature -- only projectId/user/designation', async () => {
    create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    await enqueueProjectContextBootstrapRequest({ projectId: 'proj-1', requestedByUserId: 'user-1', propertyDesignation: 'orsa stackmora 3:12' });
    expect(create).toHaveBeenCalledWith({
      data: { projectId: 'proj-1', requestedByUserId: 'user-1', propertyDesignation: 'ORSA STACKMORA 3:12' },
    });
  });

  it('lease: two workers racing for the same row -- only one gets it (updateMany count check)', async () => {
    findFirst.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    // Worker A's conditional update matches the row.
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'LEASED' });
    const workerA = await leaseOnePendingBootstrapRequest();
    expect(workerA?.id).toBe('req-1');

    // Worker B's conditional update finds status is no longer PENDING -- 0 rows matched.
    updateMany.mockResolvedValueOnce({ count: 0 });
    const workerB = await leaseOnePendingBootstrapRequest();
    expect(workerB).toBeNull();

    expect(updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'req-1', status: 'PENDING' }, data: { status: 'LEASED', leasedAt: expect.any(Date) } });
  });

  it('lease: empty queue returns null without attempting an update', async () => {
    findFirst.mockResolvedValue(null);
    const result = await leaseOnePendingBootstrapRequest();
    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('markBootstrapRequestCompleted records the binding id and completion time', async () => {
    update.mockResolvedValue({});
    await markBootstrapRequestCompleted('req-1', 'project-context-binding-abc');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'COMPLETED', contextBindingArtifactId: 'project-context-binding-abc', completedAt: expect.any(Date) },
    });
  });

  it('markBootstrapRequestFailed records a code and detail, truncated to a bounded length', async () => {
    update.mockResolvedValue({});
    await markBootstrapRequestFailed('req-1', 'PROPERTY_MISMATCH', 'x'.repeat(5000));
    const call = update.mock.calls[0][0];
    expect(call.data.status).toBe('FAILED');
    expect(call.data.failureCode).toBe('PROPERTY_MISMATCH');
    expect(call.data.failureDetail.length).toBeLessThanOrEqual(2000);
  });
});
