/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B.
 *
 * Durable work-queue state only -- `LocalizationGeometrySupersessionRequest` is never itself
 * authority for a currentness transition (see prisma/schema.prisma's model doc comment). `enqueue`
 * is safe to call from the live web server: it never accepts a supersession artifact_id,
 * issuer_ref, or signature -- only `projectId` + the pinned (predecessorGeometryArtifactId,
 * successorGeometryArtifactId) subject + `requestedByUserId`. The worker derives and signs
 * everything else itself. `leaseExpiresAt` is present from day one (H3 fix, never reproduced) --
 * same race-free reclaim pattern as viewerCapabilityProvisioningQueue.ts.
 */
import { prisma } from '../../db/prisma';
import { randomUUID } from 'node:crypto';

const LEASE_DURATION_MS = 2 * 60 * 1000;

export type TerminalQueueMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'LEASE_LOST' };

export interface LocalizationGeometrySupersessionRequestRecord {
  readonly id: string;
  readonly projectId: string;
  readonly predecessorGeometryArtifactId: string;
  readonly successorGeometryArtifactId: string;
  readonly requestedByUserId: string;
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | 'SUPERSEDED';
  readonly supersessionArtifactId: string | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly createdAt: Date;
  readonly leasedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly leaseToken: string | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
}

export async function enqueueLocalizationGeometrySupersessionRequest(input: {
  readonly projectId: string;
  readonly predecessorGeometryArtifactId: string;
  readonly successorGeometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<LocalizationGeometrySupersessionRequestRecord> {
  return prisma.localizationGeometrySupersessionRequest.create({
    data: {
      projectId: input.projectId,
      predecessorGeometryArtifactId: input.predecessorGeometryArtifactId,
      successorGeometryArtifactId: input.successorGeometryArtifactId,
      requestedByUserId: input.requestedByUserId,
    },
  });
}

/**
 * Idempotent enqueue: skips creating a new row if a non-terminal-failed request already exists for
 * this EXACT pinned (predecessor, successor) pair. A FAILED row is left for explicit retry; a
 * SUPERSEDED row does not block a fresh enqueue for a different (now-current) predecessor, since
 * its subject is by definition no longer the one being requested.
 */
export async function ensureLocalizationGeometrySupersessionRequested(input: {
  readonly projectId: string;
  readonly predecessorGeometryArtifactId: string;
  readonly successorGeometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<LocalizationGeometrySupersessionRequestRecord> {
  const existing = await getSupersessionRequestStatusForSubject(
    input.projectId,
    input.predecessorGeometryArtifactId,
    input.successorGeometryArtifactId,
  );
  if (existing && existing.status !== 'FAILED') return existing;
  try {
    return await enqueueLocalizationGeometrySupersessionRequest(input);
  } catch {
    const raced = await getSupersessionRequestStatusForSubject(
      input.projectId,
      input.predecessorGeometryArtifactId,
      input.successorGeometryArtifactId,
    );
    if (raced) return raced;
    throw new Error(
      'REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_PROVISIONING: failed to enqueue or observe a request',
    );
  }
}

/** Latest request for this EXACT pinned (predecessor, successor) pair. */
export async function getSupersessionRequestStatusForSubject(
  projectId: string,
  predecessorGeometryArtifactId: string,
  successorGeometryArtifactId: string,
): Promise<LocalizationGeometrySupersessionRequestRecord | null> {
  return prisma.localizationGeometrySupersessionRequest.findFirst({
    where: { projectId, predecessorGeometryArtifactId, successorGeometryArtifactId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Latest request for this project, regardless of subject -- for status-read/UI purposes only. */
export async function getLatestSupersessionRequestForProject(
  projectId: string,
): Promise<LocalizationGeometrySupersessionRequestRecord | null> {
  return prisma.localizationGeometrySupersessionRequest.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Atomically claims exactly one available request: a PENDING row, or a LEASED row whose lease has
 * expired (crashed-worker reclaim). A stale reclaim compares the exact observed expiry generation.
 */
export async function leaseOnePendingLocalizationGeometrySupersessionRequest(
  now: Date = new Date(),
): Promise<LocalizationGeometrySupersessionRequestRecord | null> {
  const candidate = await prisma.localizationGeometrySupersessionRequest.findFirst({
    where: {
      OR: [{ status: 'PENDING' }, { status: 'LEASED', leaseExpiresAt: { lt: now } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const claimWhere =
    candidate.status === 'LEASED'
      ? candidate.leaseExpiresAt
        ? { id: candidate.id, status: 'LEASED' as const, leaseExpiresAt: candidate.leaseExpiresAt }
        : null
      : { id: candidate.id, status: 'PENDING' as const };
  if (!claimWhere) return null;

  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const leaseToken = randomUUID();
  const result = await prisma.localizationGeometrySupersessionRequest.updateMany({
    where: claimWhere,
    data: { status: 'LEASED', leasedAt: now, leaseExpiresAt, leaseToken },
  });
  if (result.count !== 1) return null;

  return prisma.localizationGeometrySupersessionRequest.findUnique({ where: { id: candidate.id } });
}

export async function markLocalizationGeometrySupersessionCompleted(
  id: string,
  leaseToken: string,
  supersessionArtifactId: string,
): Promise<TerminalQueueMutationResult> {
  const result = await prisma.localizationGeometrySupersessionRequest.updateMany({
    where: { id, status: 'LEASED', leaseToken },
    data: { status: 'COMPLETED', supersessionArtifactId, completedAt: new Date(), leaseToken: null },
  });
  return result.count === 1 ? { ok: true } : { ok: false, reason: 'LEASE_LOST' };
}

export async function markLocalizationGeometrySupersessionFailed(
  id: string,
  leaseToken: string,
  failureCode: string,
  failureDetail: string,
): Promise<TerminalQueueMutationResult> {
  const result = await prisma.localizationGeometrySupersessionRequest.updateMany({
    where: { id, status: 'LEASED', leaseToken },
    data: {
      status: 'FAILED',
      failureCode,
      failureDetail: failureDetail.slice(0, 2000),
      failedAt: new Date(),
      leaseToken: null,
    },
  });
  return result.count === 1 ? { ok: true } : { ok: false, reason: 'LEASE_LOST' };
}

/**
 * Marks a request SUPERSEDED without mutating its pinned predecessor/successor into a new pair --
 * this is what makes a race between two rapid saves (A->B enqueued, then A->C enqueued before B's
 * worker runs) fail closed for the loser rather than silently rewriting user intent into A->B->C.
 */
export async function markLocalizationGeometrySupersessionSuperseded(
  id: string,
  leaseToken: string,
  detail: string,
): Promise<TerminalQueueMutationResult> {
  const result = await prisma.localizationGeometrySupersessionRequest.updateMany({
    where: { id, status: 'LEASED', leaseToken },
    data: {
      status: 'SUPERSEDED',
      failureCode: 'PREDECESSOR_NO_LONGER_CURRENT',
      failureDetail: detail.slice(0, 2000),
      failedAt: new Date(),
      leaseToken: null,
    },
  });
  return result.count === 1 ? { ok: true } : { ok: false, reason: 'LEASE_LOST' };
}
