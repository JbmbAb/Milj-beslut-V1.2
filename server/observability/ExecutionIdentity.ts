import crypto from 'node:crypto';

export interface ExecutionIdentity {
  readonly executionId: string;

  readonly pipelineId: string;
  readonly pipelineVersion: string;

  readonly pipelineHash: string;
  readonly manifestHash: string;
  readonly executionHash: string;

  readonly registryVersion: string;
  readonly metricsContractHash: string;
  readonly observabilitySchemaVersion: string;
}

export function createExecutionIdentity(
  pipelineId: string,
  pipelineVersion: string,
  pipelineHash: string,
  manifestHash: string,
  executionHash: string,
  registryVersion: string,
  metricsContractHash: string,
  observabilitySchemaVersion: string,
): ExecutionIdentity {
  return {
    executionId: crypto.randomUUID(),
    pipelineId,
    pipelineVersion,
    pipelineHash,
    manifestHash,
    executionHash,
    registryVersion,
    metricsContractHash,
    observabilitySchemaVersion,
  };
}
