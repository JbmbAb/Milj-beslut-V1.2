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

export type ApprovalDecisionLiteral = 'approved' | 'rejected';

/**
 * WORM approval record (ADR-042 locked contract).
 *
 * subjectId points at a promotion *candidate*, never a promotion artifact id.
 * Rejected candidates never get a PromotionArtifactV3.
 */
export interface ApprovalRecord {
  readonly approvalId: string;
  readonly subjectId: string;
  readonly subjectType: 'promotion-candidate';
  readonly decision: ApprovalDecisionLiteral;
  readonly decidedBy: string;
  readonly reason?: string;
  readonly evolutionRunId: string;
  readonly schemaVersion: 'approval.v1';
  /** ISO-8601 timestamp */
  readonly createdAt: string;
  /** sha256(canonical body) — content identity, not encryption */
  readonly artifactHash: string;
}

export type ApprovalRecordBody = Omit<ApprovalRecord, 'artifactHash'>;

export function createApprovalRecord(body: ApprovalRecordBody): ApprovalRecord {
  const payload: Record<string, unknown> = {
    approvalId: body.approvalId,
    subjectId: body.subjectId,
    subjectType: body.subjectType,
    decision: body.decision,
    decidedBy: body.decidedBy,
    reason: body.reason,
    evolutionRunId: body.evolutionRunId,
    schemaVersion: 'approval.v1',
    createdAt: body.createdAt,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  return {
    ...(payload as unknown as ApprovalRecordBody),
    artifactHash: hashArtifactPayload(payload),
  };
}

/** Map gate ApprovalDecision → locked ApprovalRecord fields. */
export function approvalRecordFromDecision(args: {
  readonly approvalId: string;
  readonly subjectId: string;
  readonly evolutionRunId: string;
  readonly gate: ApprovalDecision;
}): ApprovalRecord {
  return createApprovalRecord({
    approvalId: args.approvalId,
    subjectId: args.subjectId,
    subjectType: 'promotion-candidate',
    decision: args.gate.approved ? 'approved' : 'rejected',
    decidedBy: args.gate.reviewer ?? 'unknown',
    reason: args.gate.reason,
    evolutionRunId: args.evolutionRunId,
    schemaVersion: 'approval.v1',
    createdAt: new Date(args.gate.timestamp || Date.now()).toISOString(),
  });
}

export function approvalStoreKey(approvalId: string): string {
  return `approval/${approvalId}`;
}
