import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma';
import { getLatestAuditRow } from '../../../repositories/auditRepository';
import { appendDomainAudit } from '../../audit/public';
import { inc } from '../../observability/public';
import type { EvidenceSnapshotType } from '../types';

function stableJson(obj: unknown): string {
  const sorter = (value: any): any => {
    if (Array.isArray(value)) return value.map(sorter);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((acc: any, k) => {
          acc[k] = sorter(value[k]);
          return acc;
        }, {});
    }
    return value;
  };
  return JSON.stringify(sorter(obj));
}

export async function createCaseSnapshot(input: {
  requirementCaseId: string;
  organisationId: string;
  createdBy: string;
  snapshotType: EvidenceSnapshotType;
  submissionId?: string | null;
}): Promise<{ snapshotId: string }> {
  const requirementCaseId = String(input.requirementCaseId || '').trim();
  if (!requirementCaseId) throw new Error('requirementCaseId required');

  const rc = await prisma.requirementCase.findFirst({
    where: { id: requirementCaseId, organisationId: input.organisationId },
    select: {
      id: true,
      projectId: true,
      organisationId: true,
      caseReviewStatus: true,
      reviewStatus: true,
      caseKey: true,
      documentId: true,
      municipality: true,
      authorityType: true,
      authorityName: true,
      diarienummer: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!rc) throw new Error('Requirement case not found');

  const [requirements, citations, documents] = await Promise.all([
    prisma.requirementRecord.findMany({
      where: { caseId: requirementCaseId, projectId: rc.projectId },
      select: {
        id: true,
        requirementCode: true,
        verificationStatus: true,
        verifiedBy: true,
        verifiedAt: true,
        category: true,
        subcategory: true,
        requirementTextQuote: true,
        interpretedRequirement: true,
        legalReference: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 5000,
    }),
    prisma.requirementCitation.findMany({
      where: { caseId: requirementCaseId },
      select: {
        id: true,
        citationCode: true,
        verificationStatus: true,
        verifiedBy: true,
        verifiedAt: true,
        pageNumber: true,
        comment: true,
        quoteText: true,
        documentId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20_000,
    }),
    prisma.documentRecord.findMany({
      where: { projectId: rc.projectId, organisationId: rc.organisationId },
      select: {
        id: true,
        originalName: true,
        diskName: true,
        fileSha256: true,
        mimeType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5000,
    }),
  ]);

  const [latestAudit, firstAudit, auditTrailRowCount] = await Promise.all([
    getLatestAuditRow(),
    prisma.auditTrail.findFirst({ orderBy: [{ timestamp: 'asc' }, { id: 'asc' }], select: { id: true } }),
    prisma.auditTrail.count(),
  ]);
  const auditAnchorHash = latestAudit?.chainHash ?? 'GENESIS';
  const auditAnchorId = latestAudit?.id ?? null;
  const auditAnchorAt = latestAudit?.timestamp ?? null;
  const auditRangeStartId = firstAudit?.id ?? null;
  const auditRangeEndId = latestAudit?.id ?? null;

  const snapshotPayload = {
    requirementCase: rc,
    requirements,
    citations,
    documents,
    auditAttestation: {
      anchor: { id: auditAnchorId, chainHash: auditAnchorHash, at: auditAnchorAt },
      range: { startId: auditRangeStartId, endId: auditRangeEndId },
      totalRows: auditTrailRowCount,
    },
  };
  const contentHash = crypto.createHash('sha256').update(stableJson(snapshotPayload)).digest('hex');

  const last = await prisma.caseSnapshot.findFirst({
    where: { requirementCaseId, organisationId: rc.organisationId },
    orderBy: [{ snapshotVersion: 'desc' }, { createdAt: 'desc' }],
    select: { snapshotVersion: true },
  });
  const snapshotVersion = (last?.snapshotVersion ?? 0) + 1;

  const row = await prisma.caseSnapshot.create({
    data: {
      id: crypto.randomUUID(),
      requirementCaseId,
      projectId: rc.projectId,
      organisationId: rc.organisationId,
      submissionId: input.submissionId ? String(input.submissionId).trim() : null,
      snapshotType: input.snapshotType,
      status: 'READY',
      snapshotVersion,
      createdBy: input.createdBy,
      auditAnchorHash,
      auditAnchorId,
      auditAnchorAt,
      auditTrailRowCountAtSnapshot: auditTrailRowCount,
      contentHash,
      payload: snapshotPayload,
    } as Prisma.CaseSnapshotUncheckedCreateInput,
    select: { id: true },
  });

  await appendDomainAudit({
    entityType: 'EvidenceSnapshot',
    entityId: row.id,
    action: 'SNAPSHOT_CREATED',
    userId: input.createdBy,
    payload: {
      requirementCaseId,
      projectId: rc.projectId,
      snapshotType: input.snapshotType,
      snapshotVersion,
      auditAnchorHash,
      auditAnchorId,
      auditAnchorAt: auditAnchorAt ? auditAnchorAt.toISOString() : null,
      contentHash,
      caseReviewStatus: rc.caseReviewStatus,
      reviewStatus: rc.reviewStatus,
      submissionId: input.submissionId ?? null,
    },
  });

  inc('evidence.snapshot.created', 1);
  if (
    String(rc.reviewStatus || '').toUpperCase() === 'LOCKED' ||
    String(rc.caseReviewStatus || '').toUpperCase() === 'LOCKED'
  ) {
    inc('evidence.snapshot.created.locked', 1);
  }
  if (input.submissionId) {
    inc('evidence.snapshot.created.from_submission', 1);
  }

  return { snapshotId: row.id };
}
