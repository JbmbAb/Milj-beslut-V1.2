import type { ShadowMetrics } from './ShadowEvaluator';
import type { FitnessResult } from './FitnessResult';

export interface FitnessLimits {
  readonly maximumLatencyRegression?: number;
  readonly maximumCostIncrease?: number;
  readonly maximumErrorIncrease?: number;
}

/** Maps shadow metrics to a scalar fitness used by promotion / frontier. */
export class FitnessEngine {
  constructor(
    private readonly profile: { readonly qualityWeight: number } = { qualityWeight: 1 },
    private readonly _limits: FitnessLimits = {},
  ) {
    void this._limits;
  }

  score(metrics: ShadowMetrics): FitnessResult {
    const rawFitness =
      this.profile.qualityWeight * metrics.qualityScore -
      metrics.errorRate -
      metrics.latencyMs / 10_000 -
      metrics.costSek;
    return {
      rawFitness: Number(rawFitness.toFixed(6)),
      penalty: 0,
      fitness: Number(rawFitness.toFixed(6)),
    };
  }
}

export const DefaultFitnessProfile = { qualityWeight: 1 } as const;
