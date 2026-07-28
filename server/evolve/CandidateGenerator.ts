import type { PipelineDefinition } from '../compiler/types';
import type { MutationContext } from './MutationContext';
import type { MutationRecord } from './MutationTypes';

export interface GeneratedCandidate {
  readonly definition: PipelineDefinition;
  readonly mutation: MutationRecord;
}

export interface CandidateGenerator {
  generate(
    baseline: PipelineDefinition,
    context: MutationContext,
    populationSize: number,
  ): readonly GeneratedCandidate[];
}
