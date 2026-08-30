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
    localizationGeometrySupersessionRequest: { create, findFirst, findUnique, updateMany, update },
  },
}));

import {
  enqueueLocalizationGeometrySupersessionRequest,
  ensureLocalizationGeometrySupersessionRequested,
  leaseOnePendingLocalizationGeometrySupersessionRequest,
  markLocalizationGeometrySupersessionCompleted,
  markLocalizationGeometrySupersessionFailed,
  markLocalizationGeometrySupersessionSuperseded,
} from '../../server/modules/localization/localizationGeometrySupersessionQueue';

const SUBJECT = {
  projectId: 'proj-1',
  predecessorGeometryArtifactId: 'localization-geometry-a',
  successorGeometryArtifactId: 'localization-geometry-b',
};

describe('LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B: geometry supersession provisioning queue', () => {
  beforeEach(() => {
    create.mockReset();
    findFirst.mockReset();
    findUnique.mockReset();
    updateMany.mockReset();
    update.mockReset();
  });

  it('enqueue never accepts a supersession artifact id, issuer ref, or signature -- only the pinned predecessor/successor + requester', async () => {
    create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    await enqueueLocalizationGeometrySupersessionRequest({ ...SUBJECT, requestedByUserId: 'user-1' });
    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: SUBJECT.projectId,
        predecessorGeometryArtifactId: SUBJECT.predecessorGeometryArtifactId,
        successorGeometryArtifactId: SUBJECT.successorGeometryArtifactId,
        requestedByUserId: 'user-1',
      },
    });
  });

  it('ensureLocalizationGeometrySupersessionRequested is idempotent: an existing non-FAILED request for the exact subject is reused, not duplicated', async () => {
    findFirst.mockResolvedValue({ id: 'req-existing', status: 'PENDING', ...SUBJECT });
    const result = await ensureLocalizationGeometrySupersessionRequested({
      ...SUBJECT,
      requestedByUserId: 'user-1',
    });
    expect(result.id).toBe('req-existing');
    expect(create).not.toHaveBeenCalled();
  });

  it('ensureLocalizationGeometrySupersessionRequested re-enqueues when the only existing request FAILED', async () => {
    findFirst.mockResolvedValue({ id: 'req-failed', status: 'FAILED', ...SUBJECT });
    create.mockResolvedValue({ id: 'req-new', status: 'PENDING', ...SUBJECT });
    const result = await ensureLocalizationGeometrySupersessionRequested({
      ...SUBJECT,
      requestedByUserId: 'user-1',
    });
    expect(result.id).toBe('req-new');
    expect(create).toHaveBeenCalled();
  });

  it('lease: a PENDING row is claimed via a conditional updateMany matched on its exact prior status', async () => {
    findFirst.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'LEASED' });
    const result = await leaseOnePendingLocalizationGeometrySupersessionRequest(
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(result?.id).toBe('req-1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'PENDING' },
      data: {
        status: 'LEASED',
        leasedAt: new Date('2026-01-01T00:00:00Z'),
        leaseExpiresAt: expect.any(Date),
        leaseToken: expect.any(String),
      },
    });
  });

  it('lease: two workers racing for the same PENDING row -- only one gets it', async () => {
    findFirst.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'LEASED' });
    const workerA = await leaseOnePendingLocalizationGeometrySupersessionRequest();
    expect(workerA?.id).toBe('req-1');

    updateMany.mockResolvedValueOnce({ count: 0 });
    const workerB = await leaseOnePendingLocalizationGeometrySupersessionRequest();
    expect(workerB).toBeNull();
  });

  it('H3-pattern FIX: a stale LEASED row (lease expired) is reclaimable from day one -- the query considers PENDING OR expired-LEASED', async () => {
    const now = new Date('2026-01-01T00:10:00Z');
    findFirst.mockResolvedValue({
      id: 'req-stale',
      status: 'LEASED',
      leaseExpiresAt: new Date('2026-01-01T00:02:00Z'),
    });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-stale', status: 'LEASED' });

    const result = await leaseOnePendingLocalizationGeometrySupersessionRequest(now);

    expect(result?.id).toBe('req-stale');
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ status: 'PENDING' }, { status: 'LEASED', leaseExpiresAt: { lt: now } }] },
      orderBy: { createdAt: 'asc' },
    });
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

  it('lease: empty queue returns null without attempting an update', async () => {
    findFirst.mockResolvedValue(null);
    const result = await leaseOnePendingLocalizationGeometrySupersessionRequest();
    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('markLocalizationGeometrySupersessionCompleted records the edge id and completion time', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markLocalizationGeometrySupersessionCompleted(
        'req-1',
        'lease-token-A',
        'localization-geometry-supersession-abc',
      ),
    ).resolves.toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' },
      data: {
        status: 'COMPLETED',
        supersessionArtifactId: 'localization-geometry-supersession-abc',
        completedAt: expect.any(Date),
        leaseToken: null,
      },
    });
  });

  it('markLocalizationGeometrySupersessionFailed records a code and bounded-length detail', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markLocalizationGeometrySupersessionFailed(
        'req-1',
        'lease-token-A',
        'PREDECESSOR_GEOMETRY_UNAVAILABLE',
        'x'.repeat(5000),
      ),
    ).resolves.toEqual({
      ok: true,
    });
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' });
    expect(call.data.status).toBe('FAILED');
    expect(call.data.failureDetail.length).toBeLessThanOrEqual(2000);
    expect(call.data.leaseToken).toBeNull();
  });

  it('markLocalizationGeometrySupersessionSuperseded marks SUPERSEDED without ever writing a different predecessor/successor pair onto the row', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markLocalizationGeometrySupersessionSuperseded('req-1', 'lease-token-A', 'predecessor moved on'),
    ).resolves.toEqual({ ok: true });
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' });
    expect(call.data.status).toBe('SUPERSEDED');
    expect(call.data).not.toHaveProperty('predecessorGeometryArtifactId');
    expect(call.data).not.toHaveProperty('successorGeometryArtifactId');
    expect(call.data.leaseToken).toBeNull();
  });

  it('denies stale completion and failure attempts when their lease token is no longer current', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      markLocalizationGeometrySupersessionCompleted('req-1', 'stale-token', 'edge-stale'),
    ).resolves.toEqual({
      ok: false,
      reason: 'LEASE_LOST',
    });
    await expect(
      markLocalizationGeometrySupersessionFailed('req-1', 'stale-token', 'LATE_FAILURE', 'too late'),
    ).resolves.toEqual({
      ok: false,
      reason: 'LEASE_LOST',
    });
  });
});
