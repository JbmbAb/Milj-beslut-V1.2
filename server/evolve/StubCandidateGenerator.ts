import type { PipelineDefinition, PipelineNodeDefinition } from '../compiler/types';
import type { CandidateGenerator, GeneratedCandidate } from './CandidateGenerator';
import type { MutationContext } from './MutationContext';

type NodeWithRequirements = PipelineNodeDefinition & {
  readonly requirements?: { readonly minMemoryGb?: number; readonly gpu?: boolean };
};

/**
 * Deterministic smoke generator: varies resources / memory so hashes differ,
 * and makes the last candidate infeasible under typical memory caps.
 */
export class StubCandidateGenerator implements CandidateGenerator {
  generate(
    baseline: PipelineDefinition,
    context: MutationContext,
    populationSize: number,
  ): readonly GeneratedCandidate[] {
    const size = Math.max(1, populationSize);

    return Array.from({ length: size }, (_, i) => {
      const rejected = i === size - 1;
      const nodes = baseline.nodes.map((node) => {
        const withReq = node as NodeWithRequirements;
        return {
          ...node,
          resources: [...(node.resources ?? []), `mut-g${context.generation}-c${i}`],
          requirements: {
            ...(withReq.requirements ?? {}),
            minMemoryGb: rejected ? 99 : Math.max(1, Number(withReq.requirements?.minMemoryGb ?? 1)),
          },
        };
      });

      return {
        definition: {
          ...baseline,
          id: `${baseline.id}-g${context.generation}-c${i}`,
          version: `${baseline.version}.${context.generation}.${i}`,
          nodes,
        },
        mutation: {
          id: `m-g${context.generation}-c${i}`,
          type: rejected ? 'too-large' : 'low_risk',
          description: rejected ? 'exceeds memory budget' : 'low-risk parameter tweak',
          createdAt: Date.now(),
        },
      };
    });
  }
}
