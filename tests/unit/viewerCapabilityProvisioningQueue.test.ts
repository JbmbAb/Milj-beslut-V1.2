import { describe, expect, it, vi, beforeEach } from 'vitest';

const { create, findFirst, findMany, findUnique, updateMany, update } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    viewerCapabilityProvisioningRequest: { create, findFirst, findMany, findUnique, updateMany, update },
  },
}));

import {
  enqueueViewerCapabilityProvisioningRequest,
  ensureViewerCapabilityProvisioningRequested,
  listCompletedProvisioningRequestsForSubject,
  leaseOnePendingViewerCapabilityProvisioningRequest,
  markViewerCapabilityProvisioningCompleted,
  markViewerCapabilityProvisioningFailed,
  markViewerCapabilityProvisioningSuperseded,
} from '../../server/modules/localization/viewerCapabilityProvisioningQueue';

const SUBJECT = {
  projectId: 'proj-1',
  contextBindingArtifactId: 'project-context-binding-abc',
  releaseArtifactId: 'product-release-xyz',
  viewerIdentityArtifactId: 'viewer-identity-def',
};

const VALIDITY_WINDOW = {
  capabilityValidFrom: new Date('2026-01-01T00:00:00.000Z'),
  capabilityValidUntil: new Date('2026-01-02T00:00:00.000Z'),
};

describe('PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B: viewer capability provisioning queue', () => {
  beforeEach(() => {
    create.mockReset();
    findFirst.mockReset();
    findMany.mockReset();
    findUnique.mockReset();
    updateMany.mockReset();
    update.mockReset();
  });

  it('enqueue never accepts a capability artifact id, issuer ref, or signature -- only the pinned subject + requester', async () => {
    create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    await enqueueViewerCapabilityProvisioningRequest({
      ...SUBJECT,
      ...VALIDITY_WINDOW,
      requestedByUserId: 'user-1',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: SUBJECT.projectId,
        contextBindingArtifactId: SUBJECT.contextBindingArtifactId,
        releaseArtifactId: SUBJECT.releaseArtifactId,
        viewerIdentityArtifactId: SUBJECT.viewerIdentityArtifactId,
        capabilityValidFrom: VALIDITY_WINDOW.capabilityValidFrom,
        capabilityValidUntil: VALIDITY_WINDOW.capabilityValidUntil,
        requestedByUserId: 'user-1',
      },
    });
  });

  it('ensureViewerCapabilityProvisioningRequested is idempotent: an existing non-FAILED request for the exact subject is reused, not duplicated', async () => {
    findFirst.mockResolvedValue({ id: 'req-existing', status: 'PENDING', ...SUBJECT });
    const result = await ensureViewerCapabilityProvisioningRequested({
      ...SUBJECT,
      ...VALIDITY_WINDOW,
      requestedByUserId: 'user-1',
    });
    expect(result.id).toBe('req-existing');
    expect(create).not.toHaveBeenCalled();
  });

  it('ensureViewerCapabilityProvisioningRequested re-enqueues when the only existing request FAILED', async () => {
    findFirst.mockResolvedValue({ id: 'req-failed', status: 'FAILED', ...SUBJECT });
    create.mockResolvedValue({ id: 'req-new', status: 'PENDING', ...SUBJECT });
    const result = await ensureViewerCapabilityProvisioningRequested({
      ...SUBJECT,
      ...VALIDITY_WINDOW,
      requestedByUserId: 'user-1',
    });
    expect(result.id).toBe('req-new');
    expect(create).toHaveBeenCalled();
  });

  it('lists every completed request for the exact subject without imposing timestamp order', async () => {
    findMany.mockResolvedValue([{ id: 'req-a' }, { id: 'req-b' }]);

    await expect(
      listCompletedProvisioningRequestsForSubject(
        SUBJECT.projectId,
        SUBJECT.contextBindingArtifactId,
        SUBJECT.releaseArtifactId,
        SUBJECT.viewerIdentityArtifactId,
      ),
    ).resolves.toEqual([{ id: 'req-a' }, { id: 'req-b' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        ...SUBJECT,
        status: 'COMPLETED',
        capabilityArtifactId: { not: null },
      },
    });
  });

  it('lease: a PENDING row is claimed via a conditional updateMany matched on its exact prior status', async () => {
    findFirst.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'LEASED' });
    const result = await leaseOnePendingViewerCapabilityProvisioningRequest(new Date('2026-01-01T00:00:00Z'));
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
    const workerA = await leaseOnePendingViewerCapabilityProvisioningRequest();
    expect(workerA?.id).toBe('req-1');

    updateMany.mockResolvedValueOnce({ count: 0 });
    const workerB = await leaseOnePendingViewerCapabilityProvisioningRequest();
    expect(workerB).toBeNull();
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

    const result = await leaseOnePendingViewerCapabilityProvisioningRequest(now);

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

  it('lease: empty queue returns null without attempting an update', async () => {
    findFirst.mockResolvedValue(null);
    const result = await leaseOnePendingViewerCapabilityProvisioningRequest();
    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('markViewerCapabilityProvisioningCompleted records the capability id and completion time', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markViewerCapabilityProvisioningCompleted('req-1', 'lease-token-A', 'viewer-capability-abc'),
    ).resolves.toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' },
      data: {
        status: 'COMPLETED',
        capabilityArtifactId: 'viewer-capability-abc',
        completedAt: expect.any(Date),
        leaseToken: null,
      },
    });
  });

  it('markViewerCapabilityProvisioningFailed records a code and bounded-length detail', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markViewerCapabilityProvisioningFailed(
        'req-1',
        'lease-token-A',
        'VIEWER_IDENTITY_MISMATCH',
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

  it('markViewerCapabilityProvisioningSuperseded marks SUPERSEDED without ever writing a new subject onto the row', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      markViewerCapabilityProvisioningSuperseded('req-1', 'lease-token-A', 'binding moved on'),
    ).resolves.toEqual({ ok: true });
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'req-1', status: 'LEASED', leaseToken: 'lease-token-A' });
    expect(call.data.status).toBe('SUPERSEDED');
    expect(call.data).not.toHaveProperty('contextBindingArtifactId');
    expect(call.data).not.toHaveProperty('releaseArtifactId');
    expect(call.data).not.toHaveProperty('viewerIdentityArtifactId');
    expect(call.data.leaseToken).toBeNull();
  });

  it('denies stale completion and failure attempts when their lease token is no longer current', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      markViewerCapabilityProvisioningCompleted('req-1', 'stale-token', 'viewer-capability-stale'),
    ).resolves.toEqual({
      ok: false,
      reason: 'LEASE_LOST',
    });
    await expect(
      markViewerCapabilityProvisioningFailed('req-1', 'stale-token', 'LATE_FAILURE', 'too late'),
    ).resolves.toEqual({
      ok: false,
      reason: 'LEASE_LOST',
    });
  });
});
