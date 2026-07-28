import type { PipelineDefinition } from '../compiler/types';
import type { FitnessResult } from '../evolve/FitnessResult';
import type { MutationRecord } from '../evolve/MutationTypes';

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reviewer?: string;
  readonly reason?: string;
  readonly timestamp: number;
}

export interface PromotionArtifact {
  readonly id: string;
  readonly pipelineId: string;
  readonly parentPromotionId?: string;
  readonly parentExecutionHash?: string;
  readonly executionHash: string;
  readonly pipelineDefinition: PipelineDefinition;
  readonly mutationChain: readonly MutationRecord[];
  readonly fitness: FitnessResult;
  readonly promotedAt: number;
  readonly schemaVersion: 'promotion.v2';
  readonly artifactHash: string;
  readonly sourceExperimentId: string;
  readonly approvalDecision?: ApprovalDecision;
}
