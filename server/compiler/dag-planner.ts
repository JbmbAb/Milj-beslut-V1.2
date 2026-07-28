import type { PipelineDefinition } from './types';

export class DagPlanner {
  validate(definition: PipelineDefinition): void {
    const ids = new Set<string>();
    for (const node of definition.nodes) {
      if (ids.has(node.id)) {
        throw new Error(`Duplicate node id: ${node.id}`);
      }
      ids.add(node.id);
    }
    // Cycle detection can be added when explicit edges exist.
  }

  computeExecutionOrder(definition: PipelineDefinition): readonly string[] {
    return definition.nodes.map((n) => n.id);
  }
}
