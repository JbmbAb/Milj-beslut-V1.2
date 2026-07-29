import type { ApprovalDecision, PromotionArtifact } from '../artifact/PromotionArtifact';

/**
 * Smoke approval gate: approves when the latest mutation is tagged `low_risk`.
 * Replace with UI / policy engine in production.
 */
export class SimpleApprovalGate {
  async approve(artifact: PromotionArtifact): Promise<ApprovalDecision> {
    const latest = artifact.mutationChain[artifact.mutationChain.length - 1];
    const lowRisk = latest?.type === 'low_risk';

    return {
      approved: lowRisk,
      reviewer: 'simple-approval-gate',
      reason: lowRisk ? 'mutation tagged low_risk' : 'mutation not tagged low_risk',
      timestamp: Date.now(),
    };
  }
}
