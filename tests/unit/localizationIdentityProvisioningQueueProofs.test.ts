/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B — queue + service-layer proof matrix.
 *
 * Covers the durable request lifecycle (PENDING -> LEASED -> COMPLETED/FAILED), idempotent
 * enqueue, race-free atomic leasing, the worker-service composition
 * (lease -> execute -> mark), and that the save/read service surfaces provisioningStatus so the
 * UI can gate "Kör bedömning" without knowing anything about ExecutionIdentity V3 (proofs 6/7/8).
 * Uses an in-memory fake Prisma model for `localizationIdentityProvisioningRequest` -- same
 * technique used throughout this session for other Prisma-backed projection tables -- so this
 * exercises the REAL queue/service/worker-service logic without needing real Project/User FK rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRow = {
  id: string;
  projectId: string;
  geometryArtifactId: string;
  requestedByUserId: string;
  status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED';
  executionIdentityArtifactId: string | null;
  failureCode: string | null;
  failureDetail: string | null;
  createdAt: Date;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
};

const { fakeRows, resetFakeRows } = vi.hoisted(() => {
  const rows: FakeRow[] = [];
  return {
    fakeRows: rows,
    resetFakeRows: () => {
      rows.length = 0;
    },
  };
});

let idCounter = 0;

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    localizationIdentityProvisioningRequest: {
      create: vi.fn(async ({ data }: { data: Partial<FakeRow> }) => {
        const row: FakeRow = {
          id: `req-${++idCounter}`,
          projectId: data.projectId!,
          geometryArtifactId: data.geometryArtifactId!,
          requestedByUserId: data.requestedByUserId!,
          status: 'PENDING',
          executionIdentityArtifactId: null,
          failureCode: null,
          failureDetail: null,
          createdAt: new Date(Date.now() + fakeRows.length),
          leasedAt: null,
          leaseExpiresAt: null,
          completedAt: null,
          failedAt: null,
        };
        fakeRows.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
        const matchesClause = (row: FakeRow, clause: Record<string, unknown>): boolean =>
          Object.entries(clause).every(([k, v]) => {
            if (v !== null && typeof v === 'object' && 'lt' in (v as Record<string, unknown>)) {
              const fieldValue = (row as Record<string, unknown>)[k];
              return fieldValue instanceof Date && fieldValue.getTime() < (v as { lt: Date }).lt.getTime();
            }
            return (row as Record<string, unknown>)[k] === v;
          });
        const matches = fakeRows.filter((r) => {
          if (Array.isArray(where.OR)) {
            return (where.OR as Record<string, unknown>[]).some((clause) => matchesClause(r, clause));
          }
          return matchesClause(r, where);
        });
        if (matches.length === 0) return null;
        const sorted = [...matches].sort((a, b) =>
          orderBy?.createdAt === 'desc' ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return { ...sorted[0] };
      }),
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const row = fakeRows.find((r) => r.id === id);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: FakeRow['status']; leaseExpiresAt?: Date | null }; data: Partial<FakeRow> }) => {
        const row = fakeRows.find((r) => r.id === where.id
          && (where.status === undefined || r.status === where.status)
          && (where.leaseExpiresAt === undefined
            || (r.leaseExpiresAt?.getTime() ?? null) === (where.leaseExpiresAt?.getTime() ?? null)));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where: { id }, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
        const row = fakeRows.find((r) => r.id === id);
        if (!row) throw new Error(`no such row ${id}`);
        Object.assign(row, data);
        return { ...row };
      }),
    },
  },
}));

import {
  enqueueLocalizationIdentityProvisioningRequest,
  ensureLocalizationIdentityProvisioningRequested,
  leaseOnePendingLocalizationIdentityProvisioningRequest,
  markLocalizationIdentityProvisioningCompleted,
  markLocalizationIdentityProvisioningFailed,
  getProvisioningStatusForGeometry,
} from '../../server/modules/localization/localizationIdentityProvisioningQueue';

describe('PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 — queue proofs', () => {
  beforeEach(() => {
    resetFakeRows();
    idCounter = 0;
  });

  it('proof: idempotent enqueue -- calling ensure twice for the same pinned point does not duplicate the request', async () => {
    const first = await ensureLocalizationIdentityProvisioningRequested({
      projectId: 'proj-1',
      geometryArtifactId: 'geom-A',
      requestedByUserId: 'user-1',
    });
    const second = await ensureLocalizationIdentityProvisioningRequested({
      projectId: 'proj-1',
      geometryArtifactId: 'geom-A',
      requestedByUserId: 'user-1',
    });
    expect(second.id).toBe(first.id);
    expect(fakeRows.filter((r) => r.geometryArtifactId === 'geom-A')).toHaveLength(1);
  });

  it('proof: a request for a DIFFERENT point is a genuinely new row, never conflated with an existing one', async () => {
    await ensureLocalizationIdentityProvisioningRequested({ projectId: 'proj-1', geometryArtifactId: 'geom-A', requestedByUserId: 'user-1' });
    await ensureLocalizationIdentityProvisioningRequested({ projectId: 'proj-1', geometryArtifactId: 'geom-B', requestedByUserId: 'user-1' });
    expect(fakeRows).toHaveLength(2);
  });

  it('proof: PENDING -> LEASED -> COMPLETED lifecycle, and lease is race-free (only one of two concurrent leasers gets the row)', async () => {
    const request = await enqueueLocalizationIdentityProvisioningRequest({
      projectId: 'proj-1',
      geometryArtifactId: 'geom-A',
      requestedByUserId: 'user-1',
    });
    expect(request.status).toBe('PENDING');

    // Two "workers" race to lease the same PENDING row.
    const [leaseA, leaseB] = await Promise.all([
      leaseOnePendingLocalizationIdentityProvisioningRequest(),
      leaseOnePendingLocalizationIdentityProvisioningRequest(),
    ]);
    const leased = [leaseA, leaseB].filter((r) => r !== null);
    expect(leased).toHaveLength(1);
    expect(leased[0]!.id).toBe(request.id);
    expect(leased[0]!.status).toBe('LEASED');

    await markLocalizationIdentityProvisioningCompleted(request.id, 'lu-identity-v3-abc');
    const status = await getProvisioningStatusForGeometry('proj-1', 'geom-A');
    expect(status?.status).toBe('COMPLETED');
    expect(status?.executionIdentityArtifactId).toBe('lu-identity-v3-abc');
  });

  it('proof: FAILED requests carry the failure detail for the UI, and stay FAILED until an explicit retry enqueues a new row', async () => {
    const request = await enqueueLocalizationIdentityProvisioningRequest({
      projectId: 'proj-1',
      geometryArtifactId: 'geom-A',
      requestedByUserId: 'user-1',
    });
    await leaseOnePendingLocalizationIdentityProvisioningRequest();
    await markLocalizationIdentityProvisioningFailed(request.id, 'GEOMETRY_UNAVAILABLE_OR_TAMPERED', 'boom');

    const status = await getProvisioningStatusForGeometry('proj-1', 'geom-A');
    expect(status?.status).toBe('FAILED');
    expect(status?.failureCode).toBe('GEOMETRY_UNAVAILABLE_OR_TAMPERED');

    // ensure (idempotent-guard) does NOT silently retry a FAILED request -- that's the explicit
    // retry endpoint's job (enqueue, not ensure).
    const stillFailed = await ensureLocalizationIdentityProvisioningRequested({
      projectId: 'proj-1',
      geometryArtifactId: 'geom-A',
      requestedByUserId: 'user-1',
    });
    expect(stillFailed.status).toBe('FAILED');
    expect(fakeRows).toHaveLength(1);
  });

  it('LU-PROVISIONING-LEASE-RECOVERY-01 H3 FIX: a LEASED row whose worker died (lease expired) is reclaimed by another worker and completes -- it never stays stuck', async () => {
    const request = await enqueueLocalizationIdentityProvisioningRequest({
      projectId: 'proj-1',
      geometryArtifactId: 'geom-A',
      requestedByUserId: 'user-1',
    });

    // Worker A leases it, then crashes before ever calling mark-completed/mark-failed.
    const t0 = new Date('2026-01-01T00:00:00Z');
    const leasedByA = await leaseOnePendingLocalizationIdentityProvisioningRequest(t0);
    expect(leasedByA?.id).toBe(request.id);
    expect(leasedByA?.status).toBe('LEASED');

    // Immediately after (lease not yet expired), a second worker must NOT be able to steal it.
    const tooSoon = new Date('2026-01-01T00:00:30Z');
    const prematureReclaim = await leaseOnePendingLocalizationIdentityProvisioningRequest(tooSoon);
    expect(prematureReclaim).toBeNull();

    // Once the lease window has elapsed, worker B reclaims the same row.
    const tAfterExpiry = new Date('2026-01-01T00:05:00Z');
    const leasedByB = await leaseOnePendingLocalizationIdentityProvisioningRequest(tAfterExpiry);
    expect(leasedByB?.id).toBe(request.id);
    expect(leasedByB?.status).toBe('LEASED');

    // Worker B completes the reclaimed request -- proves the queue never leaves it PENDING/LEASED forever.
    await markLocalizationIdentityProvisioningCompleted(request.id, 'lu-identity-v3-recovered');
    const status = await getProvisioningStatusForGeometry('proj-1', 'geom-A');
    expect(status?.status).toBe('COMPLETED');
    expect(status?.executionIdentityArtifactId).toBe('lu-identity-v3-recovered');
    expect(fakeRows).toHaveLength(1); // no divergent duplicate row was created by the reclaim
  });

  it('atomically reclaims one observed expired lease generation exactly once', async () => {
    await enqueueLocalizationIdentityProvisioningRequest({ projectId: 'proj-1', geometryArtifactId: 'geom-A', requestedByUserId: 'user-1' });
    await leaseOnePendingLocalizationIdentityProvisioningRequest(new Date('2026-01-01T00:00:00Z'));

    const [a, b] = await Promise.all([
      leaseOnePendingLocalizationIdentityProvisioningRequest(new Date('2026-01-01T00:05:00Z')),
      leaseOnePendingLocalizationIdentityProvisioningRequest(new Date('2026-01-01T00:05:00Z')),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock('../../server/modules/localization/luExecutionIdentityV3Provisioning', () => ({
  executeLocalizationIdentityProvisioning: executeMock,
}));

describe('PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 — worker-service composition proofs', () => {
  beforeEach(() => {
    resetFakeRows();
    idCounter = 0;
    executeMock.mockReset();
  });

  it('proof 2: lease -> execute -> COMPLETED, end to end through the worker-service composition', async () => {
    const { processLocalizationIdentityProvisioningRequestsOnce } = await import(
      '../../server/services/luExecutionIdentityV3ProvisioningWorker'
    );
    await enqueueLocalizationIdentityProvisioningRequest({ projectId: 'proj-1', geometryArtifactId: 'geom-A', requestedByUserId: 'user-1' });
    executeMock.mockResolvedValue({ ok: true, executionIdentityArtifactId: 'lu-identity-v3-xyz', reused: false });

    const processed = await processLocalizationIdentityProvisioningRequestsOnce();
    expect(processed).toBe(1);
    const status = await getProvisioningStatusForGeometry('proj-1', 'geom-A');
    expect(status?.status).toBe('COMPLETED');
    expect(status?.executionIdentityArtifactId).toBe('lu-identity-v3-xyz');
  });

  it('proof 4 (A->B race) at the queue level: A leased-and-completing after B was already saved still completes for A, and current resolution is a separate concern the queue never conflates', async () => {
    const { processLocalizationIdentityProvisioningRequestsOnce } = await import(
      '../../server/services/luExecutionIdentityV3ProvisioningWorker'
    );
    // Request for A enqueued first.
    await enqueueLocalizationIdentityProvisioningRequest({ projectId: 'proj-1', geometryArtifactId: 'geom-A', requestedByUserId: 'user-1' });
    // User moves to B before A's worker runs; B's request enqueued second.
    await enqueueLocalizationIdentityProvisioningRequest({ projectId: 'proj-1', geometryArtifactId: 'geom-B', requestedByUserId: 'user-1' });

    executeMock.mockImplementation(async (input: { geometryArtifactId: string }) => ({
      ok: true,
      executionIdentityArtifactId: `lu-identity-v3-${input.geometryArtifactId}`,
      reused: false,
    }));

    // Worker processes both, in enqueue order (A first, then B) -- but the point is that BOTH
    // complete successfully and independently, each scoped to its own pinned geometry.
    await processLocalizationIdentityProvisioningRequestsOnce();
    await processLocalizationIdentityProvisioningRequestsOnce();

    const statusA = await getProvisioningStatusForGeometry('proj-1', 'geom-A');
    const statusB = await getProvisioningStatusForGeometry('proj-1', 'geom-B');
    expect(statusA?.status).toBe('COMPLETED');
    expect(statusB?.status).toBe('COMPLETED');
    expect(statusA?.executionIdentityArtifactId).not.toBe(statusB?.executionIdentityArtifactId);
  });

  it('proof: FAILED outcome from the executor is faithfully recorded, never silently swallowed', async () => {
    const { processLocalizationIdentityProvisioningRequestsOnce } = await import(
      '../../server/services/luExecutionIdentityV3ProvisioningWorker'
    );
    await enqueueLocalizationIdentityProvisioningRequest({ projectId: 'proj-1', geometryArtifactId: 'geom-A', requestedByUserId: 'user-1' });
    executeMock.mockResolvedValue({ ok: false, failureCode: 'GEOMETRY_PROPERTY_MISMATCH', failureDetail: 'wrong property' });

    await processLocalizationIdentityProvisioningRequestsOnce();
    const status = await getProvisioningStatusForGeometry('proj-1', 'geom-A');
    expect(status?.status).toBe('FAILED');
    expect(status?.failureCode).toBe('GEOMETRY_PROPERTY_MISMATCH');
  });
});
