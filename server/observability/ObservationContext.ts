import { randomUUID } from 'node:crypto';
import type { ExecutionIdentity } from './ExecutionIdentity';

export interface ObservationContext extends ExecutionIdentity {
  readonly requestId: string;
  readonly traceId: string;

  readonly municipality: string;
  readonly caseType: string;
  readonly geoMode: string;

  readonly nodeId?: string;
  readonly capabilityId?: string;
  readonly modelId?: string;
  readonly provider?: string;
}

export function createObservationContext(
  identity: ExecutionIdentity,
  input: {
    municipality?: string;
    caseType?: string;
    geoMode?: string;
    nodeId?: string;
    capabilityId?: string;
    modelId?: string;
    provider?: string;
  },
): ObservationContext {
  return {
    ...identity,

    requestId: randomUUID(),
    traceId: randomUUID(),

    municipality: input.municipality ?? 'unknown',
    caseType: input.caseType ?? 'unknown',
    geoMode: input.geoMode ?? 'unknown',

    nodeId: input.nodeId,
    capabilityId: input.capabilityId,
    modelId: input.modelId,
    provider: input.provider,
  };
}
