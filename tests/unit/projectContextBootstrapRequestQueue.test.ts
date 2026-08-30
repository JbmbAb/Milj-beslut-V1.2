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
    await enqueueProjectContextBootstrapRequest({
      projectId: 'proj-1',
      requestedByUserId: 'user-1',
      propertyDesignation: 'orsa stackmora 3:12',
    });
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

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'req-1', status: 'PENDING' },
      data: {
        status: 'LEASED',
        leasedAt: expect.any(Date),
        leaseExpiresAt: expect.any(Date),
        leaseToken: expect.any(String),
      },
    });
  });

  it('lease: empty queue returns null without attempting an update', async () => {
    findFirst.mockResolvedValue(null);
    const result = await leaseOnePendingBootstrapRequest();
    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('H3 FIX: a stale LEASED row (lease expired) is reclaimable -- the query considers PENDING OR expired-LEASED', async () => {
    const now = new Date('2026-01-01T00:10:00Z');
    findFirst.mockResolvedValue({
      id: 'req-stale',
      status: 'LEASED',
      leaseExpiresAt: new Date('2026-01-01T00:02:00Z'),
    });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-stale', status: 'LEASED' });

    const result = await leaseOnePendingBootstrapRequest(now);

    expect(result?.id).toBe('req-stale');
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ status: 'PENDING' }, { status: 'LEASED', leaseExpiresAt: { lt: now } }] },
      orderBy: { createdAt: 'asc' },
    });
    // Reclaim is a compare-and-swap over the observed expired lease generation.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-stale', status: 'LEASED', leaseExpiresAt: new Date('2026-01-01T00:02:00Z') },
      data: {
        status: 'LEASED',
        leasedAt: now,
        leaseExpiresAt: expect.any(Date),
        leaseToken: expect.any(String),
      },
    });
  });

  it('H3 FIX: two workers racing to reclaim the same stale LEASED row -- only one wins', async () => {
    const now = new Date('2026-01-01T00:10:00Z');
    findFirst.mockResolvedValue({
      id: 'req-stale',
      status: 'LEASED',
      leaseExpiresAt: new Date('2026-01-01T00:02:00Z'),
    });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-stale', status: 'LEASED' });
    const reclaimerA = await leaseOnePendingBootstrapRequest(now);
    expect(reclaimerA?.id).toBe('req-stale');

    updateMany.mockResolvedValueOnce({ count: 0 });
    const reclaimerB = await leaseOnePendingBootstrapRequest(now);
    expect(reclaimerB).toBeNull();
  });

  it('markBootstrapRequestCompleted records the binding id and completion time', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markBootstrapRequestCompleted('req-1', 'lease-token-A', 'project-context-binding-abc'),
    ).resolves.toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' },
      data: {
        status: 'COMPLETED',
        contextBindingArtifactId: 'project-context-binding-abc',
        completedAt: expect.any(Date),
        leaseToken: null,
      },
    });
  });

  it('markBootstrapRequestFailed records a code and detail, truncated to a bounded length', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markBootstrapRequestFailed('req-1', 'lease-token-A', 'PROPERTY_MISMATCH', 'x'.repeat(5000)),
    ).resolves.toEqual({ ok: true });
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' });
    expect(call.data.status).toBe('FAILED');
    expect(call.data.failureCode).toBe('PROPERTY_MISMATCH');
    expect(call.data.failureDetail.length).toBeLessThanOrEqual(2000);
    expect(call.data.leaseToken).toBeNull();
  });

  it('denies a stale worker completion when its lease token is no longer current', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      markBootstrapRequestCompleted('req-1', 'stale-token', 'project-context-binding-stale'),
    ).resolves.toEqual({
      ok: false,
      reason: 'LEASE_LOST',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'LEASED', leaseToken: 'stale-token' },
      data: {
        status: 'COMPLETED',
        contextBindingArtifactId: 'project-context-binding-stale',
        completedAt: expect.any(Date),
        leaseToken: null,
      },
    });
  });

  it('denies a stale worker failure when its lease token is no longer current', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      markBootstrapRequestFailed('req-1', 'stale-token', 'LATE_FAILURE', 'too late'),
    ).resolves.toEqual({
      ok: false,
      reason: 'LEASE_LOST',
    });
  });
});
