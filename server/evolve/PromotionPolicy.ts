import type { ShadowMetrics } from './ShadowEvaluator';

export interface PromotionDecision {
  readonly promote: boolean;
  readonly reasons: readonly string[];
  readonly metricsDelta: {
    readonly latency: number;
    readonly cost: number;
    readonly quality: number;
    readonly errorRate: number;
  };
}

export interface PromotionPolicy {
  readonly minQualityDelta?: number;
  readonly maxLatencyRegression?: number;
  readonly maxCostRegression?: number;
  readonly maxErrorRegression?: number;
}

export function decidePromotion(
  candidate: ShadowMetrics,
  baseline: ShadowMetrics,
  policy: PromotionPolicy,
): PromotionDecision {
  const metricsDelta = {
    latency: candidate.latencyMs - baseline.latencyMs,
    cost: candidate.costSek - baseline.costSek,
    quality: candidate.qualityScore - baseline.qualityScore,
    errorRate: candidate.errorRate - baseline.errorRate,
  };

  const reasons: string[] = [];
  if (metricsDelta.quality < (policy.minQualityDelta ?? 0)) {
    reasons.push('quality delta below policy threshold');
  }
  if (metricsDelta.latency > (policy.maxLatencyRegression ?? 0)) {
    reasons.push('latency regression above policy threshold');
  }
  if (metricsDelta.cost > (policy.maxCostRegression ?? 0)) {
    reasons.push('cost regression above policy threshold');
  }
  if (metricsDelta.errorRate > (policy.maxErrorRegression ?? 0)) {
    reasons.push('error regression above policy threshold');
  }

  return {
    promote: reasons.length === 0,
    reasons,
    metricsDelta,
  };
}
