import type { Attributes } from '@opentelemetry/api';
import type { ObservationContext } from './ObservationContext';

export function executionSpanAttributes(ctx: ObservationContext): Attributes {
  return {
    'mimer.execution_id': ctx.executionId,
    'mimer.pipeline_id': ctx.pipelineId,
    'mimer.pipeline_version': ctx.pipelineVersion,

    'mimer.pipeline_hash': ctx.pipelineHash,
    'mimer.manifest_hash': ctx.manifestHash,
    'mimer.execution_hash': ctx.executionHash,

    'mimer.registry_version': ctx.registryVersion,
    'mimer.metrics_contract_hash': ctx.metricsContractHash,
    'mimer.observability_schema_version': ctx.observabilitySchemaVersion,
  };
}
