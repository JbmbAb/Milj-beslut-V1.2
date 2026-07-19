import { prisma } from '../../../db/prisma';

export async function listCaseSnapshots(input: {
  requirementCaseId: string;
  organisationId: string;
}): Promise<
  Array<{
    id: string;
    requirementCaseId: string;
    projectId: string;
    organisationId: string;
    snapshotType: string;
    snapshotVersion: number;
    status: string;
    createdBy: string;
    createdAt: string;
    auditAnchorHash: string;
    contentHash: string;
    auditTrailRowCountAtSnapshot: number | null;
  }>
> {
  const requirementCaseId = String(input.requirementCaseId || '').trim();
  if (!requirementCaseId) throw new Error('requirementCaseId required');

  const rows = await prisma.caseSnapshot.findMany({
    where: { requirementCaseId, organisationId: input.organisationId },
    orderBy: [{ snapshotVersion: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      requirementCaseId: true,
      projectId: true,
      organisationId: true,
      snapshotType: true,
      snapshotVersion: true,
      status: true,
      createdBy: true,
      createdAt: true,
      auditAnchorHash: true,
      contentHash: true,
      auditTrailRowCountAtSnapshot: true,
    },
    take: 200,
  });

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}
