/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B.
 * LU-PROVISIONING-LEASE-RECOVERY-01 Phase B: lease reclaim added (H3 fix).
 *
 * Durable work-queue state only -- `ProjectContextBootstrapRequest` is never itself authority for
 * context/binding (see prisma/schema.prisma's model doc comment). `enqueue` is safe to call from
 * the live web server: it never accepts an artifact ref, issuer ref, or signature, only
 * `projectId` + `propertyDesignation` + the requesting principal's own user id. The worker (see
 * luProjectContextBootstrap.ts) derives everything else itself from real, already-governed
 * sources.
 *
 * Lease reclaim: a LEASED row whose `leaseExpiresAt` has passed is treated as available again,
 * exactly like a PENDING row, so a crashed worker never leaves a row stuck forever. Same pattern
 * as `viewerCapabilityProvisioningQueue.ts`'s day-one fix, retrofitted here. Safe to retry after a
 * reclaim because `executeProjectContextBootstrap` is reconciliation-first: it always re-resolves
 * the current verified binding before minting anything, so a reclaim after a crash that already
 * completed the CAS write reuses that binding instead of diverging.
 */
import { prisma } from '../../db/prisma';

const LEASE_DURATION_MS = 2 * 60 * 1000;

export interface BootstrapRequestRecord {
  readonly id: string;
  readonly projectId: string;
  readonly requestedByUserId: string;
  readonly propertyDesignation: string;
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED';
  readonly contextBindingArtifactId: string | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly createdAt: Date;
  readonly leasedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
}

export async function enqueueProjectContextBootstrapRequest(input: {
  readonly projectId: string;
  readonly requestedByUserId: string;
  readonly propertyDesignation: string;
}): Promise<BootstrapRequestRecord> {
  return prisma.projectContextBootstrapRequest.create({
    data: {
      projectId: input.projectId,
      requestedByUserId: input.requestedByUserId,
      propertyDesignation: String(input.propertyDesignation || '').trim().toUpperCase(),
    },
  });
}

export async function getBootstrapRequestStatusForProject(projectId: string): Promise<BootstrapRequestRecord | null> {
  return prisma.projectContextBootstrapRequest.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Atomically claims exactly one available request: a PENDING row, or a LEASED row whose lease has
 * expired (crashed-worker reclaim). A stale reclaim compares the exact observed expiry generation.
 */
export async function leaseOnePendingBootstrapRequest(now: Date = new Date()): Promise<BootstrapRequestRecord | null> {
  const candidate = await prisma.projectContextBootstrapRequest.findFirst({
    where: {
      OR: [{ status: 'PENDING' }, { status: 'LEASED', leaseExpiresAt: { lt: now } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const claimWhere = candidate.status === 'LEASED'
    ? candidate.leaseExpiresAt
      ? { id: candidate.id, status: 'LEASED' as const, leaseExpiresAt: candidate.leaseExpiresAt }
      : null
    : { id: candidate.id, status: 'PENDING' as const };
  if (!claimWhere) return null;

  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const result = await prisma.projectContextBootstrapRequest.updateMany({
    where: claimWhere,
    data: { status: 'LEASED', leasedAt: now, leaseExpiresAt },
  });
  if (result.count !== 1) return null;

  return prisma.projectContextBootstrapRequest.findUnique({ where: { id: candidate.id } });
}

export async function markBootstrapRequestCompleted(id: string, contextBindingArtifactId: string): Promise<void> {
  await prisma.projectContextBootstrapRequest.update({
    where: { id },
    data: { status: 'COMPLETED', contextBindingArtifactId, completedAt: new Date() },
  });
}

export async function markBootstrapRequestFailed(id: string, failureCode: string, failureDetail: string): Promise<void> {
  await prisma.projectContextBootstrapRequest.update({
    where: { id },
    data: { status: 'FAILED', failureCode, failureDetail: failureDetail.slice(0, 2000), failedAt: new Date() },
  });
}
