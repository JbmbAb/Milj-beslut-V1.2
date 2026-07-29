import { hashArtifactPayload } from '../utils/hashArtifact';

/**
 * Gate decision payload (not a sealed store record by itself).
 */
export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reviewer?: string;
  readonly reason?: string;
  readonly timestamp: number;
}

/**
 * WORM approval record.
 *
 * Invariant: ApprovalRecord.subjectId points at a promotion *candidate*
 * (experiment/candidate id), never at a promotion artifact id. PromotionArtifactV3
 * is created only after approval and points back via approvalRecordId.
 *
 * Rejected candidates never get a PromotionArtifactV3; the audit trail is
 * ExperimentRecord + ApprovalRecord alone.
 */
export interface ApprovalRecord {
  readonly approvalId: string;
  readonly subjectId: string;
  readonly subjectType: 'promotion-candidate';
  readonly decision: ApprovalDecision;
  readonly evolutionRunId: string;
  readonly schemaVersion: 'approval.v1';
  readonly createdAt: number;
  readonly artifactHash: string;
}

export type ApprovalRecordBody = Omit<ApprovalRecord, 'artifactHash'>;

export function createApprovalRecord(body: ApprovalRecordBody): ApprovalRecord {
  const payload: Record<string, unknown> = {
    approvalId: body.approvalId,
    subjectId: body.subjectId,
    subjectType: body.subjectType,
    decision: body.decision,
    evolutionRunId: body.evolutionRunId,
    schemaVersion: 'approval.v1',
    createdAt: body.createdAt,
  };
  return {
    ...(payload as unknown as ApprovalRecordBody),
    artifactHash: hashArtifactPayload(payload),
  };
}

export function approvalStoreKey(approvalId: string): string {
  return `approval/${approvalId}`;
}
