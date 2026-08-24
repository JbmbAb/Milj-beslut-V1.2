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
    viewerCapabilityProvisioningRequest: { create, findFirst, findUnique, updateMany, update },
  },
}));

import {
  enqueueViewerCapabilityProvisioningRequest,
  ensureViewerCapabilityProvisioningRequested,
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

describe('PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B: viewer capability provisioning queue', () => {
  beforeEach(() => {
    create.mockReset();
    findFirst.mockReset();
    findUnique.mockReset();
    updateMany.mockReset();
    update.mockReset();
  });

  it('enqueue never accepts a capability artifact id, issuer ref, or signature -- only the pinned subject + requester', async () => {
    create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    await enqueueViewerCapabilityProvisioningRequest({ ...SUBJECT, requestedByUserId: 'user-1' });
    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: SUBJECT.projectId,
        contextBindingArtifactId: SUBJECT.contextBindingArtifactId,
        releaseArtifactId: SUBJECT.releaseArtifactId,
        viewerIdentityArtifactId: SUBJECT.viewerIdentityArtifactId,
        requestedByUserId: 'user-1',
      },
    });
  });

  it('ensureViewerCapabilityProvisioningRequested is idempotent: an existing non-FAILED request for the exact subject is reused, not duplicated', async () => {
    findFirst.mockResolvedValue({ id: 'req-existing', status: 'PENDING', ...SUBJECT });
    const result = await ensureViewerCapabilityProvisioningRequested({ ...SUBJECT, requestedByUserId: 'user-1' });
    expect(result.id).toBe('req-existing');
    expect(create).not.toHaveBeenCalled();
  });

  it('ensureViewerCapabilityProvisioningRequested re-enqueues when the only existing request FAILED', async () => {
    findFirst.mockResolvedValue({ id: 'req-failed', status: 'FAILED', ...SUBJECT });
    create.mockResolvedValue({ id: 'req-new', status: 'PENDING', ...SUBJECT });
    const result = await ensureViewerCapabilityProvisioningRequested({ ...SUBJECT, requestedByUserId: 'user-1' });
    expect(result.id).toBe('req-new');
    expect(create).toHaveBeenCalled();
  });

  it('lease: a PENDING row is claimed via a conditional updateMany matched on its exact prior status', async () => {
    findFirst.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'LEASED' });
    const result = await leaseOnePendingViewerCapabilityProvisioningRequest(new Date('2026-01-01T00:00:00Z'));
    expect(result?.id).toBe('req-1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'PENDING' },
      data: { status: 'LEASED', leasedAt: new Date('2026-01-01T00:00:00Z'), leaseExpiresAt: expect.any(Date) },
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
    findFirst.mockResolvedValue({ id: 'req-stale', status: 'LEASED', leaseExpiresAt: new Date('2026-01-01T00:02:00Z') });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: 'req-stale', status: 'LEASED' });

    const result = await leaseOnePendingViewerCapabilityProvisioningRequest(now);

    expect(result?.id).toBe('req-stale');
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ status: 'PENDING' }, { status: 'LEASED', leaseExpiresAt: { lt: now } }] },
      orderBy: { createdAt: 'asc' },
    });
    // Reclaim is a compare-and-swap over the observed expired lease generation. Status alone
    // would let a second reclaimer overwrite the first because it remains LEASED.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'req-stale', status: 'LEASED', leaseExpiresAt: new Date('2026-01-01T00:02:00Z') },
      data: { status: 'LEASED', leasedAt: now, leaseExpiresAt: expect.any(Date) },
    });
  });

  it('lease: empty queue returns null without attempting an update', async () => {
    findFirst.mockResolvedValue(null);
    const result = await leaseOnePendingViewerCapabilityProvisioningRequest();
    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('markViewerCapabilityProvisioningCompleted records the capability id and completion time', async () => {
    update.mockResolvedValue({});
    await markViewerCapabilityProvisioningCompleted('req-1', 'viewer-capability-abc');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'COMPLETED', capabilityArtifactId: 'viewer-capability-abc', completedAt: expect.any(Date) },
    });
  });

  it('markViewerCapabilityProvisioningFailed records a code and bounded-length detail', async () => {
    update.mockResolvedValue({});
    await markViewerCapabilityProvisioningFailed('req-1', 'VIEWER_IDENTITY_MISMATCH', 'x'.repeat(5000));
    const call = update.mock.calls[0][0];
    expect(call.data.status).toBe('FAILED');
    expect(call.data.failureDetail.length).toBeLessThanOrEqual(2000);
  });

  it('markViewerCapabilityProvisioningSuperseded marks SUPERSEDED without ever writing a new subject onto the row', async () => {
    update.mockResolvedValue({});
    await markViewerCapabilityProvisioningSuperseded('req-1', 'binding moved on');
    const call = update.mock.calls[0][0];
    expect(call.data.status).toBe('SUPERSEDED');
    expect(call.data).not.toHaveProperty('contextBindingArtifactId');
    expect(call.data).not.toHaveProperty('releaseArtifactId');
    expect(call.data).not.toHaveProperty('viewerIdentityArtifactId');
  });
});
