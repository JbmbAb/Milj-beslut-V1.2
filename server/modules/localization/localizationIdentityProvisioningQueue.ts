/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B.
 * LU-PROVISIONING-LEASE-RECOVERY-01 Phase B: lease reclaim added (H3 fix).
 *
 * Durable work-queue state only -- `LocalizationIdentityProvisioningRequest` is never itself
 * authority for an ExecutionIdentity (see prisma/schema.prisma's model doc comment). `enqueue` is
 * safe to call from the live web server: it never accepts an artifact_id, content_hash, issuer_ref,
 * or signature, only `projectId` + `geometryArtifactId` (the exact PINNED point) +
 * `requestedByUserId`. The worker (see luExecutionIdentityV3Provisioning.ts) derives everything
 * else itself from real, already-governed sources -- and mints strictly for the pinned geometry,
 * never for "whatever is current" at lease time.
 *
 * Lease reclaim: a LEASED row whose `leaseExpiresAt` has passed is treated as available again,
 * exactly like a PENDING row, so a crashed worker never leaves a row stuck forever. Same pattern
 * as `viewerCapabilityProvisioningQueue.ts`'s day-one fix, retrofitted here. Safe to retry after a
 * reclaim because `executeLocalizationIdentityProvisioning` is reconciliation-first: it always
 * re-checks for an existing identity for the exact pinned subject before minting, so a reclaim
 * after a crash that already completed the CAS write reuses that identity instead of diverging.
 */
import { prisma } from '../../db/prisma';

const LEASE_DURATION_MS = 2 * 60 * 1000;

export interface LocalizationIdentityProvisioningRequestRecord {
  readonly id: string;
  readonly projectId: string;
  readonly geometryArtifactId: string;
  readonly requestedByUserId: string;
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED';
  readonly executionIdentityArtifactId: string | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly createdAt: Date;
  readonly leasedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
}

export async function enqueueLocalizationIdentityProvisioningRequest(input: {
  readonly projectId: string;
  readonly geometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<LocalizationIdentityProvisioningRequestRecord> {
  return prisma.localizationIdentityProvisioningRequest.create({
    data: {
      projectId: input.projectId,
      geometryArtifactId: input.geometryArtifactId,
      requestedByUserId: input.requestedByUserId,
    },
  });
}

/**
 * Idempotent enqueue: a geometry artifact_id is content-addressed, so calling this more than once
 * for the same point (e.g. a GET-triggered derive racing a save, or a client retry) must not flood
 * the queue with redundant requests. Skips creating a new row if ANY request already exists for
 * this exact `(projectId, geometryArtifactId)` pair, regardless of its status -- a FAILED one is
 * left for the explicit retry action to re-enqueue, not silently retried here.
 */
export async function ensureLocalizationIdentityProvisioningRequested(input: {
  readonly projectId: string;
  readonly geometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<LocalizationIdentityProvisioningRequestRecord> {
  const existing = await getProvisioningStatusForGeometry(input.projectId, input.geometryArtifactId);
  if (existing) return existing;
  try {
    return await enqueueLocalizationIdentityProvisioningRequest(input);
  } catch {
    // Lost a race against a concurrent enqueue for the same point -- re-read rather than error.
    const raced = await getProvisioningStatusForGeometry(input.projectId, input.geometryArtifactId);
    if (raced) return raced;
    throw new Error('REJECT_LOCALIZATION_IDENTITY_PROVISIONING: failed to enqueue or observe a request');
  }
}

/**
 * Latest request for this EXACT pinned geometry (not just the project) -- this is what lets the UI
 * ask "is the point I just saved execution-ready yet" without being confused by an older request
 * for a since-superseded point.
 */
export async function getProvisioningStatusForGeometry(
  projectId: string,
  geometryArtifactId: string,
): Promise<LocalizationIdentityProvisioningRequestRecord | null> {
  return prisma.localizationIdentityProvisioningRequest.findFirst({
    where: { projectId, geometryArtifactId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Atomically claims exactly one available request: a PENDING row, or a LEASED row whose lease has
 * expired (crashed-worker reclaim). A stale reclaim compares the exact observed expiry generation.
 */
export async function leaseOnePendingLocalizationIdentityProvisioningRequest(
  now: Date = new Date(),
): Promise<LocalizationIdentityProvisioningRequestRecord | null> {
  const candidate = await prisma.localizationIdentityProvisioningRequest.findFirst({
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
  const result = await prisma.localizationIdentityProvisioningRequest.updateMany({
    where: claimWhere,
    data: { status: 'LEASED', leasedAt: now, leaseExpiresAt },
  });
  if (result.count !== 1) return null;

  return prisma.localizationIdentityProvisioningRequest.findUnique({ where: { id: candidate.id } });
}

export async function markLocalizationIdentityProvisioningCompleted(
  id: string,
  executionIdentityArtifactId: string,
): Promise<void> {
  await prisma.localizationIdentityProvisioningRequest.update({
    where: { id },
    data: { status: 'COMPLETED', executionIdentityArtifactId, completedAt: new Date() },
  });
}

export async function markLocalizationIdentityProvisioningFailed(
  id: string,
  failureCode: string,
  failureDetail: string,
): Promise<void> {
  await prisma.localizationIdentityProvisioningRequest.update({
    where: { id },
    data: { status: 'FAILED', failureCode, failureDetail: failureDetail.slice(0, 2000), failedAt: new Date() },
  });
}
