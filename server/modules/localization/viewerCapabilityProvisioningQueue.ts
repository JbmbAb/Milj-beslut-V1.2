/**
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B.
 *
 * Durable work-queue state only -- `ViewerCapabilityProvisioningRequest` is never itself
 * authority for a ProductViewerCapability (see prisma/schema.prisma's model doc comment).
 * `enqueue` is safe to call from the live web server: it never accepts an artifact_id,
 * content_hash, issuer_ref, or signature -- only `projectId` + the pinned
 * (contextBindingArtifactId, releaseArtifactId, viewerIdentityArtifactId) subject +
 * `requestedByUserId`. The worker derives everything else itself.
 *
 * Lease reclaim (fixes the known H3-class defect in the two earlier queues this pattern is
 * copied from): a LEASED row whose `leaseExpiresAt` has passed is treated as available again,
 * exactly like a PENDING row, so a crashed worker never leaves a row stuck forever.
 */
import { prisma } from '../../db/prisma';

const LEASE_DURATION_MS = 2 * 60 * 1000;

export interface ViewerCapabilityProvisioningRequestRecord {
  readonly id: string;
  readonly projectId: string;
  readonly contextBindingArtifactId: string;
  readonly releaseArtifactId: string;
  readonly viewerIdentityArtifactId: string;
  readonly requestedByUserId: string;
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | 'SUPERSEDED';
  readonly capabilityArtifactId: string | null;
  /**
   * PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1: the capability-issuance validity
   * window, decided once by the web layer at enqueue time -- the worker reads these values
   * verbatim and never derives or refreshes them (never binding.created_at, never
   * release.issued_at, never Date.now() at mint time). Nullable only for rows enqueued before
   * this field existed.
   */
  readonly capabilityValidFrom: Date | null;
  readonly capabilityValidUntil: Date | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly createdAt: Date;
  readonly leasedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
}

export async function enqueueViewerCapabilityProvisioningRequest(input: {
  readonly projectId: string;
  readonly contextBindingArtifactId: string;
  readonly releaseArtifactId: string;
  readonly viewerIdentityArtifactId: string;
  readonly requestedByUserId: string;
  readonly capabilityValidFrom: Date;
  readonly capabilityValidUntil: Date;
}): Promise<ViewerCapabilityProvisioningRequestRecord> {
  return prisma.viewerCapabilityProvisioningRequest.create({
    data: {
      projectId: input.projectId,
      contextBindingArtifactId: input.contextBindingArtifactId,
      releaseArtifactId: input.releaseArtifactId,
      viewerIdentityArtifactId: input.viewerIdentityArtifactId,
      requestedByUserId: input.requestedByUserId,
      capabilityValidFrom: input.capabilityValidFrom,
      capabilityValidUntil: input.capabilityValidUntil,
    },
  });
}

/**
 * Idempotent enqueue: skips creating a new row if a non-terminal-failed request already exists
 * for this EXACT pinned subject (project + binding + release + viewer identity). A FAILED row is
 * left for explicit retry, not silently re-enqueued here -- same convention as the identity-v3
 * queue. A SUPERSEDED row also does not block a fresh enqueue for a NEW current subject, since a
 * superseded row's subject is by definition no longer the one being requested.
 */
export async function ensureViewerCapabilityProvisioningRequested(input: {
  readonly projectId: string;
  readonly contextBindingArtifactId: string;
  readonly releaseArtifactId: string;
  readonly viewerIdentityArtifactId: string;
  readonly requestedByUserId: string;
  readonly capabilityValidFrom: Date;
  readonly capabilityValidUntil: Date;
}): Promise<ViewerCapabilityProvisioningRequestRecord> {
  const existing = await getProvisioningStatusForSubject(
    input.projectId,
    input.contextBindingArtifactId,
    input.releaseArtifactId,
    input.viewerIdentityArtifactId,
  );
  if (existing && existing.status !== 'FAILED') return existing;
  try {
    return await enqueueViewerCapabilityProvisioningRequest(input);
  } catch {
    // Lost a race against a concurrent enqueue for the same exact subject -- re-read rather than error.
    const raced = await getProvisioningStatusForSubject(
      input.projectId,
      input.contextBindingArtifactId,
      input.releaseArtifactId,
      input.viewerIdentityArtifactId,
    );
    if (raced) return raced;
    throw new Error('REJECT_VIEWER_CAPABILITY_PROVISIONING: failed to enqueue or observe a request');
  }
}

/** Latest request for this EXACT pinned subject. */
export async function getProvisioningStatusForSubject(
  projectId: string,
  contextBindingArtifactId: string,
  releaseArtifactId: string,
  viewerIdentityArtifactId: string,
): Promise<ViewerCapabilityProvisioningRequestRecord | null> {
  return prisma.viewerCapabilityProvisioningRequest.findFirst({
    where: { projectId, contextBindingArtifactId, releaseArtifactId, viewerIdentityArtifactId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Latest request for this project, regardless of subject -- for status-read/UI purposes only. */
export async function getLatestProvisioningRequestForProject(
  projectId: string,
): Promise<ViewerCapabilityProvisioningRequestRecord | null> {
  return prisma.viewerCapabilityProvisioningRequest.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Atomically claims exactly one available request: a PENDING row, or a LEASED row whose lease has
 * expired (crashed-worker reclaim). `updateMany` compares a PENDING row's status, or a stale
 * LEASED row's exact observed expiry generation, so only one worker can claim the stale lease.
 */
export async function leaseOnePendingViewerCapabilityProvisioningRequest(
  now: Date = new Date(),
): Promise<ViewerCapabilityProvisioningRequestRecord | null> {
  const candidate = await prisma.viewerCapabilityProvisioningRequest.findFirst({
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
  const result = await prisma.viewerCapabilityProvisioningRequest.updateMany({
    where: claimWhere,
    data: { status: 'LEASED', leasedAt: now, leaseExpiresAt },
  });
  if (result.count !== 1) return null;

  return prisma.viewerCapabilityProvisioningRequest.findUnique({ where: { id: candidate.id } });
}

export async function markViewerCapabilityProvisioningCompleted(
  id: string,
  capabilityArtifactId: string,
): Promise<void> {
  await prisma.viewerCapabilityProvisioningRequest.update({
    where: { id },
    data: { status: 'COMPLETED', capabilityArtifactId, completedAt: new Date() },
  });
}

export async function markViewerCapabilityProvisioningFailed(
  id: string,
  failureCode: string,
  failureDetail: string,
): Promise<void> {
  await prisma.viewerCapabilityProvisioningRequest.update({
    where: { id },
    data: { status: 'FAILED', failureCode, failureDetail: failureDetail.slice(0, 2000), failedAt: new Date() },
  });
}

/**
 * Marks a request SUPERSEDED without mutating its pinned subject into a new one -- owner
 * invariant: "if the pinned binding/release becomes obsolete, the request becomes STALE/
 * FAILED_SUPERSEDED; do NOT mutate the request into a new subject; enqueue/reconcile a new
 * request from trusted current state instead."
 */
export async function markViewerCapabilityProvisioningSuperseded(
  id: string,
  detail: string,
): Promise<void> {
  await prisma.viewerCapabilityProvisioningRequest.update({
    where: { id },
    data: { status: 'SUPERSEDED', failureCode: 'SUBJECT_SUPERSEDED', failureDetail: detail.slice(0, 2000), failedAt: new Date() },
  });
}
