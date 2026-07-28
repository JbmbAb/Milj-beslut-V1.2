import type { PipelineDefinition, PipelineNodeDefinition } from '../compiler/types';

export interface ConstraintContext {
  readonly runtimeCapabilities: Record<string, unknown>;
  readonly runtimeProfile?: string;
}

export interface ConstraintViolation {
  readonly reason: string;
}

export interface ConstraintSolver {
  validate(
    definition: PipelineDefinition,
    context: ConstraintContext,
  ): Promise<readonly ConstraintViolation[]>;
}

interface NodeRequirements {
  readonly gpu?: boolean;
  readonly minMemoryGb?: number;
}

type PipelineNodeWithRequirements = PipelineNodeDefinition & {
  readonly requirements?: NodeRequirements;
};

export class SimpleConstraintSolver implements ConstraintSolver {
  async validate(
    definition: PipelineDefinition,
    context: ConstraintContext,
  ): Promise<readonly ConstraintViolation[]> {
    const violations: ConstraintViolation[] = [];

    for (const node of definition.nodes as readonly PipelineNodeWithRequirements[]) {
      const requirements = node.requirements;
      if (!requirements) continue;

      if (requirements.gpu === true && context.runtimeCapabilities.gpu !== true) {
        violations.push({ reason: `Node ${node.id} requires GPU but runtime has none` });
      }

      const memoryGb = Number(context.runtimeCapabilities.memoryGb ?? 0);
      if (requirements.minMemoryGb !== undefined && memoryGb < requirements.minMemoryGb) {
        violations.push({ reason: `Node ${node.id} requires ${requirements.minMemoryGb}GB memory` });
      }
    }

    return violations;
  }
}
