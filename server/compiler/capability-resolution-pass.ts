import type { PipelineDefinition, CapabilityImplementation } from './types';

export interface ResolvedCapabilityBinding {
  readonly nodeId: string;
  readonly capabilityId: string;
  readonly implementationId: string;
  readonly implementationVersion: string;
  readonly runtimeProfile: string;
}

export class CapabilityResolutionPass {
  constructor(private readonly implementations: readonly CapabilityImplementation[]) {}

  run(definition: PipelineDefinition): readonly ResolvedCapabilityBinding[] {
    const implByNode = new Map<string, ResolvedCapabilityBinding>();

    for (const node of definition.nodes) {
      const impl = this.implementations.find((c) => c.capabilityId === node.capability);

      if (!impl) {
        throw new Error(
          `No implementation found for capability ${node.capability} (node ${node.id})`,
        );
      }

      implByNode.set(node.id, {
        nodeId: node.id,
        capabilityId: impl.capabilityId,
        implementationId: impl.id,
        implementationVersion: impl.version,
        runtimeProfile: impl.runtimeProfile,
      });
    }

    return Array.from(implByNode.values());
  }
}
