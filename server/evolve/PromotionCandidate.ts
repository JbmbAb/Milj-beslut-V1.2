import type { FitnessResult } from './FitnessResult';
import type { MutationRecord } from './MutationTypes';

/**
 * Non-sealed promotion candidate presented to ApprovalGate.
 * Never signed; never written under promotion/.
 */
export interface PromotionCandidate {
  readonly candidateId: string;
  readonly experimentId: string;
  readonly evolutionRunId: string;
  readonly humanId: string;
  readonly pipelineId: string;
  readonly parentPromotionId?: string;
  readonly parentExecutionHash?: string;
  readonly executionHash: string;
  readonly pipelineDefinitionRef: string;
  /** Inline definition used only to materialize pipelineDefinitionRef / store side data. */
  readonly pipelineDefinition: unknown;
  readonly mutationChain: readonly MutationRecord[];
  readonly fitness: FitnessResult;
  readonly runtimeFingerprint?: string;
  readonly policySnapshotRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
