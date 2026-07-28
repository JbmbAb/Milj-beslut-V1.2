import type { FitnessResult } from './FitnessResult';
import type { MutationRecord } from './MutationTypes';
import type { PromotionDecision } from './PromotionPolicy';
import type { ShadowMetrics } from './ShadowEvaluator';

export interface ExperimentRecord {
  readonly id: string;
  readonly generation: number;
  readonly experimentId: string;
  readonly mutation: MutationRecord;
  readonly candidateExecutionHash: string;
  readonly baselineExecutionHash: string;
  readonly metricsCandidate: ShadowMetrics;
  readonly metricsBaseline: ShadowMetrics;
  readonly fitnessCandidate: FitnessResult;
  readonly fitnessBaseline: FitnessResult;
  readonly promotion: PromotionDecision;
  readonly searchSpaceHash?: string;
  readonly compilerVersion?: string;
  readonly registryVersion?: string;
  readonly createdAt: number;
  readonly schemaVersion: 'experiment.v1';
  readonly evolutionRunId: string;
  readonly artifactHash: string;
}
