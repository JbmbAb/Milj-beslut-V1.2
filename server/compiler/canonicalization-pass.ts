import type {
  PipelineDefinition,
  CanonicalManifest,
  PipelineNodeDefinition,
  ResourceBinding,
} from './types';
import type { ResolvedCapabilityBinding } from './capability-resolution-pass';
import type { ResolvedPolicyBinding } from './policy-resolution-pass';

export class CanonicalizationPass {
  run(
    definition: PipelineDefinition,
    capabilities: readonly ResolvedCapabilityBinding[],
    policies: readonly ResolvedPolicyBinding[],
    resources: readonly ResourceBinding[],
  ): CanonicalManifest {
    const policyByNode = new Map<string, ResolvedPolicyBinding>(
      policies.map((p) => [p.nodeId, p]),
    );

    const capByNode = new Map<string, ResolvedCapabilityBinding>(
      capabilities.map((c) => [c.nodeId, c]),
    );

    const resByNode = new Map<string, string[]>();
    for (const binding of resources) {
      const arr = resByNode.get(binding.nodeId) ?? [];
      arr.push(binding.resourceId);
      resByNode.set(binding.nodeId, arr);
    }

    const nodes = definition.nodes.map((node) => {
      const cap = capByNode.get(node.id);
      const pol = policyByNode.get(node.id);
      const res = resByNode.get(node.id) ?? [];

      if (!cap || !pol) {
        throw new Error(`Missing capability or policy for node ${node.id}`);
      }

      return {
        id: node.id,
        capabilityId: cap.capabilityId,
        implementationId: cap.implementationId,
        policyId: pol.policyId,
        resources: res,
        inputs: [...(node.inputs ?? [])],
        outputs: [...(node.outputs ?? inferOutputs(node))],
      };
    });

    return {
      pipelineId: definition.id,
      pipelineVersion: definition.version,
      nodes,
    };
  }
}

function inferOutputs(node: PipelineNodeDefinition): readonly string[] {
  return node.outputs ?? [`${node.id}:output`];
}
