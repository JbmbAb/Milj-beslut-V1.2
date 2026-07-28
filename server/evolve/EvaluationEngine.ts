import type { CompilationResult } from '../compiler/types';
import type { PipelineDefinition } from '../compiler/types';
import type { FitnessResult } from './FitnessResult';
import type { ShadowMetrics } from './ShadowEvaluator';

export interface EvaluationResult {
  readonly metricsCandidate: ShadowMetrics;
  readonly metricsBaseline: ShadowMetrics;
  readonly fitnessCandidate: FitnessResult;
  readonly fitnessBaseline: FitnessResult;
}

export interface EvaluationEngine {
  compile(definition: PipelineDefinition): Promise<CompilationResult>;
  evaluateBatch(
    candidates: readonly CompilationResult[],
    baseline: CompilationResult,
  ): Promise<readonly EvaluationResult[]>;
}
