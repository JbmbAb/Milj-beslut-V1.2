/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B.
 *
 * Durable work-queue state only -- `ProjectContextBootstrapRequest` is never itself authority for
 * context/binding (see prisma/schema.prisma's model doc comment). `enqueue` is safe to call from
 * the live web server: it never accepts an artifact ref, issuer ref, or signature, only
 * `projectId` + `propertyDesignation` + the requesting principal's own user id. The worker (see
 * luProjectContextBootstrap.ts) derives everything else itself from real, already-governed
 * sources.
 */
import { prisma } from '../../db/prisma';

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
 * Atomically claims exactly one PENDING request. The conditional `updateMany` (matching on both
 * `id` AND `status: 'PENDING'`) is what makes concurrent leasing race-free under Postgres's
 * standard row-level locking: if two workers race, only one UPDATE actually matches a still-
 * PENDING row -- the other observes `count === 0` and returns null rather than a false lease.
 */
export async function leaseOnePendingBootstrapRequest(): Promise<BootstrapRequestRecord | null> {
  const candidate = await prisma.projectContextBootstrapRequest.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const result = await prisma.projectContextBootstrapRequest.updateMany({
    where: { id: candidate.id, status: 'PENDING' },
    data: { status: 'LEASED', leasedAt: new Date() },
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
