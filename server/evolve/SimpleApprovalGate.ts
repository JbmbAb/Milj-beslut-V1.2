import type { ApprovalDecision } from '../artifact/ApprovalRecord';
import type { PromotionCandidate } from './PromotionCandidate';

/**
 * Smoke approval gate: approves when the latest mutation is tagged `low_risk`.
 * Operates on PromotionCandidate (pre-artifact), never on a sealed PromotionArtifact.
 */
export class SimpleApprovalGate {
  async approve(candidate: PromotionCandidate): Promise<ApprovalDecision> {
    const latest = candidate.mutationChain[candidate.mutationChain.length - 1];
    const lowRisk = latest?.type === 'low_risk';

    return {
      approved: lowRisk,
      reviewer: 'simple-approval-gate',
      reason: lowRisk ? 'mutation tagged low_risk' : 'mutation not tagged low_risk',
      timestamp: Date.now(),
    };
  }
}
