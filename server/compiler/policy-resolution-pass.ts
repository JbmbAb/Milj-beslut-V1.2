import type { PipelineDefinition, ExecutionPolicy } from './types';

export interface ResolvedPolicyBinding {
  readonly nodeId: string;
  readonly policyId: string;
  readonly policy: ExecutionPolicy;
}

/**
 * Resolves policies by matching `ExecutionPolicy.name` to `node.capability`.
 * Fixtures should set policy.name === capability id.
 */
export class PolicyResolutionPass {
  constructor(private readonly policies: readonly ExecutionPolicy[]) {}

  run(definition: PipelineDefinition): readonly ResolvedPolicyBinding[] {
    const bindings: ResolvedPolicyBinding[] = [];

    for (const node of definition.nodes) {
      const policy = this.policies.find((p) => p.name === node.capability);

      if (!policy) {
        throw new Error(
          `No policy found for node ${node.id} (capability ${node.capability})`,
        );
      }

      bindings.push({
        nodeId: node.id,
        policyId: policy.id,
        policy,
      });
    }

    return bindings;
  }
}
