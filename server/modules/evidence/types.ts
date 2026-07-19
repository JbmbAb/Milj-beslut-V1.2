import { z } from 'zod';

export const evidenceSnapshotTypeSchema = z.enum(['LOCK', 'EXPORT', 'SUBMISSION', 'REVIEW']);
export type EvidenceSnapshotType = z.infer<typeof evidenceSnapshotTypeSchema>;

export const evidenceExportFormatSchema = z.enum(['ZIP', 'DOCX', 'JSON']);
export type EvidenceExportFormat = z.infer<typeof evidenceExportFormatSchema>;

export interface EvidenceSnapshot {
  id: string;
  requirementCaseId: string;
  projectId: string;
  organisationId: string;
  submissionId?: string | null;
  snapshotType: EvidenceSnapshotType;
  snapshotVersion: number;
  status: 'BUILDING' | 'READY' | 'FAILED' | 'SUPERSEDED';
  createdBy: string;
  createdAt: string;
  auditAnchorHash: string;
  auditAnchorId?: string | null;
  auditAnchorAt?: string | null;
  contentHash: string;
}

export interface EvidenceExportRecord {
  id: string;
  snapshotId: string;
  requirementCaseId: string;
  projectId: string;
  organisationId: string;
  format: EvidenceExportFormat;
  createdBy: string;
  createdAt: string;
  manifest: Record<string, unknown>;
}
