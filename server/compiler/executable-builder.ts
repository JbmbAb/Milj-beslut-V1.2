import type {
  CanonicalManifest,
  ExecutableNode,
  ExecutablePipeline,
  ExecutionHashes,
} from './types';

export class ExecutableBuilder {
  build(
    manifest: CanonicalManifest,
    hashes: ExecutionHashes,
    executionOrder: readonly string[],
  ): ExecutablePipeline {
    const nodes: ExecutableNode[] = manifest.nodes.map((n) => ({
      id: n.id,
      capabilityId: n.capabilityId,
      implementationId: n.implementationId,
      policyId: n.policyId,
      resources: n.resources,
      inputs: n.inputs,
      outputs: n.outputs,
    }));

    return {
      id: manifest.pipelineId,
      version: manifest.pipelineVersion,
      manifest,
      hashes,
      executionOrder,
      nodes,
    };
  }
}
