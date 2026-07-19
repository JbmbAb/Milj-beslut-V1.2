import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma';
import { appendDomainAudit } from '../../audit/public';
import { inc } from '../../observability/public';
import type { EvidenceExportFormat } from '../types';
import { buildExportManifestV2, manifestContentHash } from '../lib/stableManifest';

export async function exportFromSnapshot(input: {
  snapshotId: string;
  organisationId: string;
  createdBy: string;
  format: EvidenceExportFormat;
}): Promise<{ exportId: string }> {
  const snapshotId = String(input.snapshotId || '').trim();
  if (!snapshotId) throw new Error('snapshotId required');

  const snapshot = await prisma.caseSnapshot.findFirst({
    where: { id: snapshotId, organisationId: input.organisationId },
    select: {
      id: true,
      requirementCaseId: true,
      projectId: true,
      organisationId: true,
      snapshotType: true,
      snapshotVersion: true,
      auditAnchorHash: true,
      auditAnchorId: true,
      auditAnchorAt: true,
      auditTrailRowCountAtSnapshot: true,
      contentHash: true,
    },
  });
  if (!snapshot) throw new Error('Snapshot not found');

  const kase = await prisma.requirementCase.findFirst({
    where: { id: snapshot.requirementCaseId, organisationId: input.organisationId },
    select: { caseReviewStatus: true },
  });

  const exportCreatedAt = new Date().toISOString();
  const row = await prisma.evidenceExport.create({
    data: {
      id: crypto.randomUUID(),
      snapshotId: snapshot.id,
      requirementCaseId: snapshot.requirementCaseId,
      projectId: snapshot.projectId,
      organisationId: snapshot.organisationId,
      format: input.format,
      createdBy: input.createdBy,
      manifest: { manifestVersion: 2, placeholder: true },
    } as Prisma.EvidenceExportUncheckedCreateInput,
    select: { id: true },
  });

  const finalManifest = buildExportManifestV2({
    exportId: row.id,
    requirementCaseId: snapshot.requirementCaseId,
    projectId: snapshot.projectId,
    organisationId: snapshot.organisationId,
    snapshotId: snapshot.id,
    snapshotType: snapshot.snapshotType,
    snapshotVersion: snapshot.snapshotVersion,
    caseReviewStatusAtExport: kase?.caseReviewStatus ?? null,
    exportCreatedAt,
    exportCreatedBy: input.createdBy,
    format: input.format,
    auditAnchorHash: snapshot.auditAnchorHash,
    auditAnchorId: snapshot.auditAnchorId,
    auditAnchorAt: snapshot.auditAnchorAt ? snapshot.auditAnchorAt.toISOString() : null,
    auditTrailRowCountAtSnapshot: snapshot.auditTrailRowCountAtSnapshot,
    contentHash: snapshot.contentHash,
  });
  finalManifest.manifestContentHash = manifestContentHash(finalManifest);

  await prisma.evidenceExport.update({
    where: { id: row.id },
    data: { manifest: finalManifest as object },
  });

  await appendDomainAudit({
    entityType: 'EvidenceExport',
    entityId: row.id,
    action: 'EXPORT_CREATED',
    userId: input.createdBy,
    payload: {
      exportId: row.id,
      snapshotId: snapshot.id,
      requirementCaseId: snapshot.requirementCaseId,
      projectId: snapshot.projectId,
      format: input.format,
      snapshotVersion: snapshot.snapshotVersion,
      auditAnchorHash: snapshot.auditAnchorHash,
      manifestVersion: finalManifest.manifestVersion,
      manifestContentHash: finalManifest.manifestContentHash,
    },
  });

  inc('evidence.export.created', 1);
  if (String(snapshot.snapshotType || '').toUpperCase() === 'LOCK') {
    inc('evidence.export.created.from_locked_snapshot', 1);
  } else {
    inc('evidence.export.created.from_unlocked_snapshot', 1);
  }

  return { exportId: row.id };
}
