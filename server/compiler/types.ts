export interface PipelineNodeDefinition {
  readonly id: string;
  readonly capability: string;
  readonly inputs?: readonly string[];
  readonly outputs?: readonly string[];
  readonly resources?: readonly string[];
}

export interface PipelineDefinition {
  readonly id: string;
  readonly version: string;
  readonly nodes: readonly PipelineNodeDefinition[];
}

export interface ExecutionPolicy {
  readonly id: string;
  readonly name: string;
  readonly config: Record<string, unknown>;
}

export interface CapabilityImplementation {
  readonly id: string;
  readonly capabilityId: string;
  readonly version: string;
  readonly runtimeProfile: string;
}

export interface ResourceBinding {
  readonly nodeId: string;
  readonly resourceId: string;
}

export interface CanonicalManifest {
  readonly pipelineId: string;
  readonly pipelineVersion: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly capabilityId: string;
    readonly implementationId: string;
    readonly policyId: string;
    readonly resources: readonly string[];
    readonly inputs: readonly string[];
    readonly outputs: readonly string[];
  }[];
}

export interface ExecutionHashes {
  readonly manifestHash: string;
  readonly executionHash: string;
}

export interface ExecutableNode {
  readonly id: string;
  readonly capabilityId: string;
  readonly implementationId: string;
  readonly policyId: string;
  readonly resources: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

export interface ExecutablePipeline {
  readonly id: string;
  readonly version: string;
  readonly manifest: CanonicalManifest;
  readonly hashes: ExecutionHashes;
  readonly executionOrder: readonly string[];
  readonly nodes: readonly ExecutableNode[];
}

export interface CompilationResult {
  readonly pipeline: ExecutablePipeline;
  readonly manifest: CanonicalManifest;
  readonly hashes: ExecutionHashes;
  readonly warnings: readonly string[];
  readonly durationMs: number;
}
