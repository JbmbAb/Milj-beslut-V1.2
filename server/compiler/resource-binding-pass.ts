import type { PipelineDefinition, ResourceBinding } from './types';

export interface ResourceBindingResult {
  readonly definition: PipelineDefinition;
  readonly bindings: readonly ResourceBinding[];
}

export class ResourceBindingPass {
  run(definition: PipelineDefinition): ResourceBindingResult {
    const bindings: ResourceBinding[] = [];

    for (const node of definition.nodes) {
      for (const res of node.resources ?? []) {
        bindings.push({
          nodeId: node.id,
          resourceId: res,
        });
      }
    }

    return { definition, bindings };
  }
}
