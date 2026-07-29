import type { CompilationResult } from '../compiler/types';
import type { ShadowMetrics } from './ShadowEvaluator';

export interface ShadowEvaluationResult {
  readonly metricsCandidate: ShadowMetrics;
  readonly metricsBaseline: ShadowMetrics;
}

/**
 * Deterministic batch shadow stub for integration tests.
 * Replace with real GPU/IO shadow evaluation in production.
 */
export class BatchShadowEvaluator {
  async evaluateBatch(
    compiledCandidates: readonly CompilationResult[],
    compiledBaseline: CompilationResult,
  ): Promise<ShadowEvaluationResult[]> {
    const baselineSeed = hashSeed(compiledBaseline.pipeline.hashes.executionHash);
    const baselineMetrics: ShadowMetrics = {
      latencyMs: 200 + (baselineSeed % 20),
      costSek: 0.02,
      qualityScore: 0.9,
      errorRate: 0.01,
    };

    return compiledCandidates.map((candidate, i) => {
      const quality = baselineMetrics.qualityScore + 0.01 * (i + 1);
      const latency = baselineMetrics.latencyMs + 50 * (i + 1);
      const cost = baselineMetrics.costSek + 0.005 * (i + 1);
      const error = baselineMetrics.errorRate + 0.001 * (i % 2);
      void candidate;

      return {
        metricsCandidate: {
          latencyMs: Math.round(latency),
          costSek: Number(cost.toFixed(4)),
          qualityScore: Number(quality.toFixed(3)),
          errorRate: Number(error.toFixed(4)),
        },
        metricsBaseline: baselineMetrics,
      };
    });
  }

  async evaluate(
    candidate: CompilationResult,
    baseline: CompilationResult,
  ): Promise<ShadowEvaluationResult> {
    const [result] = await this.evaluateBatch([candidate], baseline);
    if (!result) {
      throw new Error('evaluateBatch returned no results');
    }
    return result;
  }
}

function hashSeed(executionHash: string): number {
  let n = 0;
  for (let i = 0; i < executionHash.length; i += 1) {
    n = (n * 31 + executionHash.charCodeAt(i)) >>> 0;
  }
  return n;
}
